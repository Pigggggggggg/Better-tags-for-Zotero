"use strict";
var TagWorkspaceGroups = {
  bindGroups() {
    const click = (id, action) => this.$(id).addEventListener("click", () => this.guard(action));
    click("new-group", () => this.openGroupEditor());
    click("cancel-group", () => this.$("group-dialog").close());
    click("save-group", () => this.saveGroupEditor());
    this.$("group-tag-search").addEventListener("input", () => this.renderGroupMembers());
    this.$("group-name").addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.saveGroupEditor(); }
    });
    click("delete-group", () => {
      const group = this.groups.find(g => g.id === this.editingGroupID);
      if (!group) throw new Error("分组已不存在。");
      const count = TagWorkspaceCore.descendants(this.groups, group.id).size;
      this.$("delete-group-description").textContent = `删除「${group.name}」及其 ${count - 1} 个子分组？文献和 Zotero 原生标签都会保留。`;
      this.$("delete-group-dialog").showModal();
    });
    click("cancel-delete-group", () => this.$("delete-group-dialog").close());
    click("confirm-delete-group", () => {
      this.service.deleteGroup(this.editingLibraryID, this.editingGroupID);
      this.$("delete-group-dialog").close(); this.$("group-dialog").close();
      this.groups = this.service.readGroups(this.libraryID);
      const notice = this.apply();
      this.status(`已删除分组结构，文献和标签已保留。${notice}`);
    });
  },
  tagButton({ tag, count }) {
    const button = this.button("", "tag-option", event => this.tagClick(tag, event));
    button.dataset.tag = tag;
    button.setAttribute("aria-pressed", this.state.tags.includes(tag));
    button.style.setProperty("--tag-color", this.service.tagColor(this.libraryID, tag));
    button.append(this.element("span", "tag-name", tag), document.createTextNode(" "), this.element("span", "tag-number", count));
    button.title = `${tag} · ${count} 篇文献 · 单击切换，Ctrl / Alt＋单击多选 · 右键改名或配色`;
    return button;
  },
  clearGroupDrag() {
    this.dragGroup = null;
    this.groupDropTarget = null;
    for (const node of this.$("tag-list").querySelectorAll(".drop-before,.drop-after,.group-dragging")) {
      node.classList.remove("drop-before", "drop-after", "group-dragging");
    }
  },
  bindGroupDrag(box, heading, handle, group) {
    // Native HTML drag on buttons is inconsistent in Zotero's chrome iframe.
    // Use pointer capture so moving a group works the same as moving the float.
    handle.draggable = false;
    handle.title += " · 拖动调整同层级顺序；Alt＋↑/↓也可移动";
    let start = null;
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, moved: false };
      this.suppressGroupClick = false;
      if (event.isTrusted) handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!start) return;
      if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      event.preventDefault();
      start.moved = true;
      this.dragGroup = { id: group.id, parentID: group.parentID, libraryID: this.libraryID };
      box.classList.add("group-dragging");
      for (const node of this.$("tag-list").querySelectorAll(".drop-before,.drop-after")) node.classList.remove("drop-before", "drop-after");
      this.groupDropTarget = null;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".group-heading");
      const id = target?.closest(".group-node")?.dataset.groupId;
      const other = this.groups.find(g => g.id === id);
      if (other && other.id !== group.id && other.parentID === group.parentID) {
        const bounds = target.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        this.groupDropTarget = { id, after };
        target.classList.add(after ? "drop-after" : "drop-before");
      }
      const list = this.$("tag-list"), viewport = list.getBoundingClientRect();
      if (event.clientY < viewport.top + 28) list.scrollTop -= 18;
      else if (event.clientY > viewport.bottom - 28) list.scrollTop += 18;
    });
    const finish = (cancelled = false) => {
      if (!start) return;
      const target = this.groupDropTarget;
      const moved = start.moved;
      start = null;
      this.suppressGroupClick = moved;
      if (moved) setTimeout(() => { this.suppressGroupClick = false; }, 0);
      this.clearGroupDrag();
      if (!cancelled && moved && target) this.guard(() => this.moveGroup(group.id, target.id, target.after));
    };
    handle.addEventListener("pointerup", () => finish());
    handle.addEventListener("pointercancel", () => finish(true));
    handle.addEventListener("lostpointercapture", () => finish(true));
    handle.addEventListener("keydown", event => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const siblings = this.groups.filter(g => g.parentID === group.parentID);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const target = siblings[siblings.findIndex(g => g.id === group.id) + step];
      if (target) this.guard(() => {
        this.moveGroup(group.id, target.id, step > 0);
        [...this.$("tag-list").querySelectorAll(".group-node")].find(n => n.dataset.groupId === group.id)?.querySelector(".group-title").focus();
      });
    });
  },
  moveGroup(id, targetID, after) {
    this.service.reorderGroup(this.libraryID, id, targetID, after);
    this.groups = this.service.readGroups(this.libraryID);
    this.renderTags(); this.status("分组顺序已保存。");
  },
  renderGroupTree(facets, query) {
    const values = new Map(facets.map(f => [f.tag, f]));
    const nodes = [];
    const matches = new Set();
    const expandedMatches = new Set();
    if (query) {
      for (const group of this.groups) {
        if (group.name.toLocaleLowerCase().includes(query)) {
          for (const id of TagWorkspaceCore.descendants(this.groups, group.id)) expandedMatches.add(id);
        }
        if (group.tags.some(tag => values.has(tag) && tag.toLocaleLowerCase().includes(query))) matches.add(group.id);
      }
      for (const id of expandedMatches) matches.add(id);
      // Include ancestors of all matches, even if they were collapsed before search.
      const byID = new Map(this.groups.map(g => [g.id, g]));
      for (const id of [...matches]) {
        let current = byID.get(id);
        while (current?.parentID) { matches.add(current.parentID); current = byID.get(current.parentID); }
      }
    }
    const renderGroup = group => {
      if (query && !matches.has(group.id)) return null;
      const box = this.element("div", "group-node"); box.dataset.groupId = group.id;
      const heading = this.element("div", "group-heading");
      heading.classList.toggle("active", this.state.groupID === group.id);
      const expanded = !!query || !group.collapsed;
      const toggle = this.button(`${expanded ? "▾" : "▸"} ${group.name}`, "group-title", () => {
        if (this.suppressGroupClick) { this.suppressGroupClick = false; return; }
        this.service.toggleGroup(this.libraryID, group.id);
        this.groups = this.service.readGroups(this.libraryID); this.renderTags();
      });
      toggle.setAttribute("aria-expanded", expanded);
      toggle.title = TagWorkspaceCore.groupPath(this.groups, group.id);
      this.bindGroupDrag(box, heading, toggle, group);
      const filter = this.button("筛选", "group-action", () => this.filterGroup(group.id));
      filter.setAttribute("aria-label", `筛选本组 ${group.name}（含子组）`);
      const validCount = TagWorkspaceCore.groupTags(this.groups, group.id).filter(t => values.has(t)).length;
      filter.title = `筛选本组及子组标签的并集；当前可见 ${validCount} 个标签`;
      const add = this.button("＋", "group-action", () => this.openGroupEditor(null, group.id));
      add.setAttribute("aria-label", `在 ${group.name} 下新建子分组`);
      const edit = this.button("⋯", "group-action", () => this.openGroupEditor(group.id));
      edit.setAttribute("aria-label", `编辑分组 ${group.name}`);
      edit.title = "编辑名称、父分组和标签，或删除分组";
      heading.append(toggle, filter, add, edit); box.append(heading);
      if (expanded) {
        const children = this.element("div", "group-contents");
        const tags = group.tags.filter(t => values.has(t) && (!query || expandedMatches.has(group.id) || t.toLocaleLowerCase().includes(query))).sort(TagWorkspaceCore.compareTags);
        const cloud = this.element("div", "tag-cloud");
        for (const tag of tags.slice(0, this.tagLimit)) cloud.append(this.tagButton(values.get(tag)));
        if (cloud.childElementCount) children.append(cloud);
        if (tags.length > this.tagLimit) children.append(this.button("显示更多标签", "subtle", () => { this.tagLimit += 250; this.renderTags(); }));
        for (const child of this.groups.filter(g => g.parentID === group.id)) {
          const rendered = renderGroup(child); if (rendered) children.append(rendered);
        }
        if (!children.childElementCount) children.append(this.element("p", "caption group-empty", "暂无可见标签 · 点 ⋯ 编辑"));
        box.append(children);
      }
      return box;
    };
    for (const group of this.groups.filter(g => !g.parentID)) {
      const rendered = renderGroup(group); if (rendered) nodes.push(rendered);
    }
    const assigned = new Set(this.groups.flatMap(g => g.tags));
    const ungrouped = facets.filter(f => !assigned.has(f.tag) && (!query || f.tag.toLocaleLowerCase().includes(query)));
    if (ungrouped.length) {
      const section = this.element("section", "ungrouped");
      section.append(this.element("h3", "", `未分组标签 · ${ungrouped.length}`));
      const cloud = this.element("div", "tag-cloud");
      for (const value of ungrouped.slice(0, this.tagLimit)) cloud.append(this.tagButton(value));
      section.append(cloud);
      if (ungrouped.length > this.tagLimit) section.append(this.button("显示更多未分组标签", "subtle", () => { this.tagLimit += 250; this.renderTags(); }));
      nodes.push(section);
    }
    if (!nodes.length) nodes.push(this.element("p", "caption", query ? "没有匹配的分组或标签。" : "点击「New」创建你的标签层级。"));
    const scroll = this.$("tag-list").scrollTop;
    this.$("tag-list").replaceChildren(...nodes); this.$("tag-list").scrollTop = scroll;
  },
  filterGroup(id) {
    this.flushQuery();
    this.state.groupID = id;
    this.state.untagged = false;
    this.apply();
    this.status("已筛选本组及所有子组的标签并集，可继续叠加标签或文字条件。");
  },
  openGroupEditor(id = null, parentID = null) {
    this.groups = this.service.readGroups(this.libraryID);
    const group = this.groups.find(g => g.id === id);
    if (id && !group) throw new Error("该分组已不存在。");
    this.editingGroupID = id; this.editingLibraryID = this.libraryID;
    this.groupMemberSelection = new Set(group ? group.tags : this.state.tags);
    this.$("group-dialog-title").textContent = group ? "编辑标签分组" : "新建标签分组";
    this.$("group-name").value = group?.name || "";
    this.$("group-error").textContent = ""; this.$("group-tag-search").value = "";
    const forbidden = id ? TagWorkspaceCore.descendants(this.groups, id) : new Set();
    const rootOption = this.element("option", "", "无（顶层分组）"); rootOption.value = "";
    this.$("group-parent").replaceChildren(rootOption, ...this.groups.filter(g => !forbidden.has(g.id)).map(g => {
      const option = this.element("option", "", TagWorkspaceCore.groupPath(this.groups, g.id)); option.value = g.id; return option;
    }));
    this.$("group-parent").value = group?.parentID || parentID || "";
    this.$("delete-group").hidden = !group;
    this.renderGroupMembers(); this.$("group-dialog").showModal(); this.$("group-name").focus();
  },
  renderGroupMembers() {
    const query = this.$("group-tag-search").value.trim().toLocaleLowerCase();
    const facets = new Map(TagWorkspaceCore.facets(this.records).map(f => [f.tag, f.count]));
    const tags = [...new Set([...facets.keys(), ...this.groupMemberSelection])].sort(TagWorkspaceCore.compareTags);
    const nodes = tags.filter(t => t.toLocaleLowerCase().includes(query)).map(tag => {
      const label = this.element("label", "group-member");
      const input = this.element("input"); input.type = "checkbox";
      input.checked = this.groupMemberSelection.has(tag);
      input.addEventListener("change", () => {
        if (input.checked) this.groupMemberSelection.add(tag); else this.groupMemberSelection.delete(tag);
        this.$("group-member-count").textContent = `已选 ${this.groupMemberSelection.size} 个标签 · 一个标签可属于多个分组`;
      });
      label.append(input, this.element("span", "member-name", tag),
        this.element("span", "muted", facets.has(tag) ? `${facets.get(tag)} 篇` : "当前无条目"));
      return label;
    });
    if (!nodes.length) nodes.push(this.element("p", "caption", "没有可选标签，可先建立空分组。"));
    this.$("group-members").replaceChildren(...nodes);
    this.$("group-member-count").textContent = `已选 ${this.groupMemberSelection.size} 个标签 · 一个标签可属于多个分组`;
  },
  saveGroupEditor() {
    try {
      if (this.libraryID !== this.editingLibraryID) throw new Error("文库已变化，请重新打开分组编辑器。");
      this.service.saveGroup(this.editingLibraryID, { id: this.editingGroupID,
        name: this.$("group-name").value, parentID: this.$("group-parent").value || null,
        tags: [...this.groupMemberSelection] });
      this.groups = this.service.readGroups(this.libraryID);
      this.$("group-dialog").close(); this.apply(); this.status("分组已保存。文献上的原生标签保持不变。");
    } catch (error) { this.$("group-error").textContent = error.message; }
  }
};

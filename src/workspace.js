"use strict";
var TagWorkspaceUI = {
  ...TagWorkspaceGroups,
  renderChunk: 100,
  renderedCount: 100,
  records: [],
  matches: [],
  selected: new Set(),
  state: TagWorkspaceCore.normalizeState(),
  scopeIDs: null,
  loadVersion: 0,
  busy: false,
  loading: false,
  disposed: false,
  tagLimit: 250,
  recordsReady: false,
  groups: [],
  $(id) { return document.getElementById(id); },
  element(tag, className, text) {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },
  button(text, className, action) {
    const button = this.element("button", className, text);
    button.type = "button";
    button.addEventListener("click", event => this.guard(() => action(event)));
    return button;
  },
  status(text, error = false) {
    if (this.disposed) return;
    this.$("status").textContent = text;
    this.$("status").classList.toggle("error", error);
  },
  async guard(action) {
    try { return await action(); }
    catch (error) { this.service.z.logError(error); this.status(error.message || String(error), true); }
  },
  async init() {
    const args = window.frameElement.betterTagsContext;
    this.service = args.service;
    this.libraryID = args.libraryID;
    this.renderLibraries();
    this.bind();
    this.bindGroups();
    this.observer = this.service.z.Notifier.registerObserver({
      notify: () => {
        if (this.disposed) return;
        this.scheduleRefresh();
      }
    }, ["item", "item-tag", "tag", "group"], "tag-workspace");
    window.addEventListener("unload", () => this.dispose(), { once: true });
    window.addEventListener("blur", event => {
      if (event.target === window || event.target === document) this.wasAway = true;
    });
    window.addEventListener("focus", event => {
      if ((event.target === window || event.target === document) && this.wasAway) {
        this.wasAway = false; this.scheduleRefresh(true);
      }
    });
    this.renderPresets();
    if (args.ids?.length) await this.importIDs(this.libraryID, args.ids);
    else await this.load();
  },
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadVersion++;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.queryTimer);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.resultResizeObserver?.disconnect();
    if (this.observer) this.service.z.Notifier.unregisterObserver(this.observer);
    this.observer = null;
  },
  scheduleRefresh(preserveSelection = false) {
    if (this.disposed) return;
    this.refreshPreservesSelection = this.refreshTimer ? this.refreshPreservesSelection && preserveSelection : preserveSelection;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.busy) this.needsRefresh = true;
      else this.guard(() => this.load({ preserveSelection: this.refreshPreservesSelection }));
    }, 250);
  },
  bind() {
    const click = (id, action) => this.$(id).addEventListener("click", () => this.guard(action));
    // Alt is a per-click modifier; releasing it never clears selected tags.
    // Prevent Zotero's menu activation while using Alt inside the workspace.
    for (const type of ["keydown", "keyup"]) document.addEventListener(type, event => {
      if (event.key === "Alt") { event.preventDefault(); event.stopPropagation(); }
    });
    this.$("library").addEventListener("change", () => this.guard(async () => {
      this.libraryID = Number(this.$("library").value);
      this.state = TagWorkspaceCore.normalizeState(); this.scopeIDs = null; this.renderedCount = this.renderChunk;
      this.recordsReady = false; this.records = []; this.groups = [];
      clearTimeout(this.queryTimer); this.queryTimer = null; this.$("query").value = "";
      this.renderPresets(); await this.load();
    }));
    this.$("tag-search").addEventListener("input", () => { this.tagLimit = 250; this.renderTags(); });
    this.$("manual-only").addEventListener("change", () => this.renderTags());
    click("mode-all", () => { this.state.mode = "all"; this.apply(); });
    click("mode-any", () => { this.state.mode = "any"; this.apply(); });
    click("clear", () => this.clear()); click("empty-reset", () => this.clear());
    this.$("query").addEventListener("input", () => {
      // Clear selection immediately, before the debounced result update.
      this.selected.clear(); this.updateSelection();
      clearTimeout(this.queryTimer);
      this.queryTimer = setTimeout(() => { this.queryTimer = null; this.state.query = this.$("query").value; this.apply(); }, 160);
    });
    this.$("untagged").addEventListener("change", () => {
      this.state.untagged = this.$("untagged").checked;
      if (this.state.untagged) this.state.tags = [];
      this.apply();
    });
    this.$("sort").addEventListener("change", () => this.apply());
    this.$("select-all").addEventListener("change", () => {
      this.selected = new Set(this.$("select-all").checked ? this.matches.map(r => r.id) : []);
      this.renderResults();
    });
    this.$("results-scroll").addEventListener("scroll", () => this.scheduleMoreResults(), { passive: true });
    this.resultResizeObserver = new ResizeObserver(() => this.scheduleMoreResults());
    this.resultResizeObserver.observe(this.$("results-scroll"));
    click("import-selected", () => this.importIDs(this.libraryID,
      this.service.selectedFromMain(this.service.mainWindow(), this.libraryID)));
    click("add-tags", () => this.edit("add"));
    click("remove-tags", () => {
      const names = TagWorkspaceCore.parseTags(this.$("tag-input").value);
      if (!names.length) throw new Error("请输入需要移除的标签，每行一个。");
      this.removeRequest = { libraryID: this.libraryID, ids: [...this.selected], text: names.join("\n") };
      this.$("remove-description").textContent = `将从已勾选的 ${this.selected.size} 篇文献中移除以下 ${names.length} 个标签：`;
      this.$("remove-names").textContent = names.join("\n");
      this.$("remove-dialog").showModal();
    });
    click("cancel-remove", () => this.$("remove-dialog").close());
    click("confirm-remove", () => {
      const request = this.removeRequest;
      this.$("remove-dialog").close();
      return this.edit("remove", request);
    });
    click("undo", () => this.runWrite(async () => {
      const count = await this.service.undo();
      return `已撤销 ${count} 篇文献的上一次标签修改。`;
    }));
    click("save-preset", () => {
      this.flushQuery();
      this.$("preset-name").value = ""; this.$("preset-error").textContent = "";
      this.$("preset-dialog").showModal(); this.$("preset-name").focus();
    });
    click("confirm-preset", () => this.savePreset());
    this.$("preset-name").addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.savePreset(); }
    });
  },
  renderLibraries() {
    const libraries = this.service.libraries();
    if (!libraries.some(l => l.id === this.libraryID)) this.libraryID = this.service.z.Libraries.userLibraryID;
    this.$("library").replaceChildren(...libraries.map(l => {
      const option = this.element("option", "", l.name + (l.editable ? "" : "（只读）"));
      option.value = l.id; return option;
    }));
    this.$("library").value = this.libraryID;
  },
  async load({ preserveSelection = false } = {}) {
    if (this.disposed || this.busy) return;
    // This read already includes notifications received before it began. Do not
    // let their queued duplicate refresh clear a newly made selection afterward.
    clearTimeout(this.refreshTimer); this.refreshTimer = null;
    const version = ++this.loadVersion;
    this.loading = true;
    if (!preserveSelection) this.selected.clear();
    this.updateSelection();
    this.$("select-all").disabled = true;
    this.status("正在读取文库…");
    try {
      const previousLibrary = this.libraryID;
      this.renderLibraries();
      if (previousLibrary !== this.libraryID) {
        this.selected.clear();
        this.state = TagWorkspaceCore.normalizeState(); this.scopeIDs = null; this.recordsReady = false;
        clearTimeout(this.queryTimer); this.queryTimer = null; this.$("query").value = "";
      }
      const records = await this.service.records(this.libraryID);
      if (this.disposed || version !== this.loadVersion) return;
      this.records = records.map(record => ({ ...record, titleText: TagWorkspaceTitles.plain(document, record.title) }));
      this.recordsReady = true;
      this.groups = this.service.readGroups(this.libraryID);
      if (this.queryTimer) this.flushQuery();
      this.loading = false;
      const changes = this.apply(false, preserveSelection);
      const visible = new Set(this.matches.map(r => r.id));
      for (const id of this.selected) if (!visible.has(id)) this.selected.delete(id);
      this.renderResults();
      this.renderPresets();
      this.status(changes || `已读取 ${records.length} 篇文献。点击左侧标签或分组开始筛选。`);
    } catch (error) {
      if (version === this.loadVersion && !this.disposed) {
        // A read error is not evidence that the library or a selected tag is empty.
        this.loading = false;
      }
      throw error;
    } finally {
      if (!this.disposed && version === this.loadVersion) {
        this.loading = false; this.updateSelection();
      }
    }
  },
  flushQuery() {
    clearTimeout(this.queryTimer);
    this.queryTimer = null;
    this.state.query = this.$("query").value;
  },
  clear() {
    clearTimeout(this.queryTimer);
    this.queryTimer = null;
    this.state = TagWorkspaceCore.normalizeState(); this.scopeIDs = null; this.apply();
  },
  tagClick(tag, event) {
    event.preventDefault(); event.stopPropagation();
    this.toggleTag(tag, event.altKey);
  },
  toggleTag(tag, additive = false) {
    this.flushQuery();
    this.state.untagged = false;
    this.state.tags = additive
      ? (this.state.tags.includes(tag) ? this.state.tags.filter(t => t !== tag) : [...this.state.tags, tag])
      : [tag];
    this.apply();
  },
  apply(resetScroll = true, preserveSelection = false) {
    if (resetScroll) { this.renderedCount = this.renderChunk; this.$("results-scroll").scrollTop = 0; }
    if (!preserveSelection) this.selected.clear();
    let notice = "";
    if (this.recordsReady) {
      const reconciled = TagWorkspaceCore.reconcileState(this.state, this.records);
      this.state = reconciled.state;
      if (reconciled.removed.length) notice = `已取消 ${reconciled.removed.length} 个当前文库中已无条目的标签条件。`;
      if (this.state.groupID && !this.groups.some(g => g.id === this.state.groupID)) {
        this.state.groupID = null; notice += "已取消不存在的分组条件。";
      }
    }
    const source = this.scopeIDs ? this.records.filter(r => this.scopeIDs.has(r.id)) : this.records;
    const groupTags = TagWorkspaceCore.groupTags(this.groups, this.state.groupID);
    this.matches = TagWorkspaceCore.sorted(TagWorkspaceCore.filter(source, this.state, groupTags), this.$("sort").value);
    this.$("query").value = this.state.query;
    this.$("untagged").checked = this.state.untagged;
    this.$("mode-all").setAttribute("aria-pressed", this.state.mode === "all");
    this.$("mode-any").setAttribute("aria-pressed", this.state.mode === "any");
    this.$("scope-note").textContent = this.scopeIDs
      ? "已导入所选条目 · 清空筛选可返回整个文库"
      : "整个文库";
    this.$("scope-note").hidden = !this.scopeIDs;
    this.$("save-preset").disabled = !!this.scopeIDs;
    const chips = this.state.tags.map(tag => {
      const chip = this.button(tag, "chip", () => this.toggleTag(tag, true));
      chip.append(this.element("span", "close", "×"));
      chip.setAttribute("aria-label", `取消标签 ${tag}`);
      return chip;
    });
    if (this.state.groupID) {
      const path = TagWorkspaceCore.groupPath(this.groups, this.state.groupID);
      const chip = this.button(`分组：${path}（含子组） ×`, "chip group-chip", () => {
        this.state.groupID = null; this.apply();
      });
      chip.setAttribute("aria-label", `取消分组筛选 ${path}`);
      chips.unshift(chip);
    }
    if (!chips.length && this.state.untagged) chips.push(this.element("span", "muted", "只显示未打标签的文献"));
    this.$("selected-tags").replaceChildren(...chips);
    this.$("selected-tags").hidden = !chips.length;
    this.renderTags(); this.renderResults();
    if (notice) this.status(notice);
    return notice;
  },
  renderTags() {
    const all = TagWorkspaceCore.facets(this.records, this.$("manual-only").checked);
    const query = this.$("tag-search").value.trim().toLocaleLowerCase();
    this.$("tag-count").textContent = `${all.length} 个`;
    this.renderGroupTree(all, query);
  },
  resultRow(record) {
      const row = this.element("tr"); row.dataset.itemId = record.id;
      row.classList.toggle("selected", this.selected.has(record.id));
      const select = this.element("input"); select.type = "checkbox";
      select.checked = this.selected.has(record.id); select.disabled = this.busy || this.loading;
      select.setAttribute("aria-label", `选择 ${record.titleText ?? record.title}`);
      select.addEventListener("change", () => {
        if (select.checked) this.selected.add(record.id); else this.selected.delete(record.id);
        row.classList.toggle("selected", select.checked); this.updateSelection();
      });
      const cell = this.element("td", "select-cell"); cell.append(select); row.append(cell);
      const title = this.element("td");
      const link = this.button("", "item-title", () => this.service.read(record.id));
      link.append(TagWorkspaceTitles.fragment(document, record.title));
      link.title = "打开文献";
      const meta = this.element("div", "item-meta");
      const go = this.button("Go", "item-go", () => this.service.locate(record.id));
      go.title = "在 Zotero 中定位此条目";
      go.setAttribute("aria-label", `Go：定位 ${record.titleText ?? record.title}`);
      meta.append(this.element("span", "item-author", record.creator || record.type), go);
      title.append(link, meta);
      row.append(title, this.element("td", "year-cell", record.year || "—"));
      const tags = this.element("td"); const tagBox = this.element("div", "item-tags");
      for (const tag of record.tags.slice(0, 5)) {
        const chip = this.button(tag.tag, "item-tag", event => this.tagClick(tag.tag, event));
        chip.title = (tag.type ? "自动标签：" : "手动标签：") + tag.tag + " · 单击切换，Alt＋单击多选";
        tagBox.append(chip);
      }
      if (record.tags.length > 5) {
        const more = this.element("span", "muted", `+${record.tags.length - 5}`);
        more.title = record.tags.slice(5).map(t => t.tag).join("\n"); tagBox.append(more);
      }
      if (!record.tags.length) tagBox.append(this.element("span", "muted", "未打标签"));
      tags.append(tagBox); row.append(tags);
      return row;
  },
  renderResults() {
    const scroll = this.$("results-scroll").scrollTop;
    const rows = this.matches.slice(0, this.renderedCount).map(record => this.resultRow(record));
    this.$("results").replaceChildren(...rows);
    this.$("results-scroll").scrollTop = scroll;
    this.$("empty").hidden = this.matches.length > 0;
    this.$("result-count").textContent = this.matches.length;
    this.$("total-count").textContent = `/ ${this.records.length} 篇`;
    this.updateSelection();
    this.scheduleMoreResults();
  },
  scheduleMoreResults() {
    if (this.disposed || this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.disposed) return;
      const box = this.$("results-scroll");
      if (!box.clientHeight || this.$("results").children.length >= this.matches.length ||
        box.scrollHeight - box.scrollTop - box.clientHeight > 400) return;
      const start = this.$("results").children.length;
      this.renderedCount = Math.min(this.matches.length, start + this.renderChunk);
      const rows = this.matches.slice(start, this.renderedCount).map(record => this.resultRow(record));
      this.$("results").append(...rows);
      this.scheduleMoreResults();
    });
  },
  updateSelection() {
    const editable = this.service.libraries().find(l => l.id === this.libraryID)?.editable;
    this.$("selection-count").textContent = `已选 ${this.selected.size} 篇`;
    if (this.selected.size && !this.lastSelectionSize) this.$("batch-editor").open = true;
    this.lastSelectionSize = this.selected.size;
    this.$("add-tags").disabled = this.$("remove-tags").disabled = !editable || !this.selected.size || this.busy || this.loading;
    const undo = this.service.undoEntry;
    this.$("undo").disabled = !undo || undo.libraryID !== this.libraryID || this.busy || this.loading;
    const items = this.matches;
    this.$("select-all").checked = !!items.length && this.selected.size === items.length;
    this.$("select-all").indeterminate = this.selected.size > 0 && !this.$("select-all").checked;
    this.$("select-all").disabled = !items.length || this.busy || this.loading;
    this.$("edit-hint").textContent = editable
      ? "新增标签会保存为 Zotero 原生手动标签。空格和逗号属于标签名称。"
      : "当前文库为只读，可以筛选和查阅，不能修改标签。";
  },
  async importIDs(libraryID, ids) {
    if (!ids.length) throw new Error("请先在 Zotero 主窗口中选择当前文库的文献。");
    if (this.busy) return;
    if (this.libraryID !== libraryID) this.recordsReady = false;
    this.libraryID = libraryID; this.state = TagWorkspaceCore.normalizeState();
    clearTimeout(this.queryTimer); this.queryTimer = null; this.$("query").value = "";
    this.scopeIDs = new Set(ids); this.renderedCount = this.renderChunk;
    await this.load();
    this.selected = new Set(this.matches.map(r => r.id)); this.renderResults();
    this.status(`已导入并勾选 ${this.selected.size} 篇文献。`);
  },
  async runWrite(action) {
    if (this.busy || this.loading) return;
    this.busy = true;
    this.$("library").disabled = this.$("import-selected").disabled = true;
    this.updateSelection(); this.status("正在保存标签，请稍候…");
    let message;
    try { message = await action(); }
    finally {
      this.busy = false;
      this.$("library").disabled = this.$("import-selected").disabled = false;
      clearTimeout(this.refreshTimer); this.refreshTimer = null; this.needsRefresh = false;
      await this.load();
    }
    if (message) this.status(message);
  },
  async edit(action, request = null) {
    const target = request || { libraryID: this.libraryID, ids: [...this.selected], text: this.$("tag-input").value };
    return this.runWrite(async () => {
      const count = await this.service.changeTags(target.libraryID, target.ids, target.text, action);
      return count ? `已${action === "add" ? "添加" : "移除"}标签，更新 ${count} 篇文献。可撤销上次修改。` : "没有需要修改的标签，原有标签已保留。";
    });
  },
  renderPresets() {
    const entries = this.service.readPresets().filter(e => e.libraryID === this.libraryID);
    const rows = entries.map(entry => {
      const row = this.element("div", "preset-row");
      const button = this.button(entry.name, "preset-name subtle", () => {
        clearTimeout(this.queryTimer);
        this.state = TagWorkspaceCore.normalizeState(entry.state); this.scopeIDs = null;
        const notice = this.apply();
        this.status(`已恢复组合「${entry.name}」。${notice}`);
      });
      button.title = entry.name;
      const remove = this.button("×", "subtle", () => { this.service.deletePreset(entry.id); this.renderPresets(); });
      remove.setAttribute("aria-label", `删除组合 ${entry.name}`);
      remove.title = "删除这个筛选组合（不影响文献或标签）";
      row.append(button, remove); return row;
    });
    if (!rows.length) rows.push(this.element("p", "caption", "把常用的标签搭配留在这里。"));
    this.$("presets").replaceChildren(...rows);
  },
  savePreset() {
    try {
      this.service.savePreset(this.$("preset-name").value, this.libraryID, this.state);
      this.$("preset-dialog").close(); this.renderPresets(); this.status("筛选组合已保存到本机。");
    } catch (error) { this.$("preset-error").textContent = error.message; }
  }
};
// Chrome XHTML windows may execute external scripts before the body is parsed,
// even when defer is present. Wait explicitly before touching any controls.
TagWorkspaceUI.ready = (async () => {
  if (document.readyState === "loading") {
    await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return TagWorkspaceUI.guard(() => TagWorkspaceUI.init());
})();

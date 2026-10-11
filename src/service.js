"use strict";
var TagWorkspacePalette = Object.freeze([
  { id: "mint", name: "薄荷绿", color: "#CDEADB" },
  { id: "leaf", name: "嫩草绿", color: "#DEECC6" },
  { id: "lemon", name: "柠檬黄", color: "#F7E8B1" },
  { id: "peach", name: "蜜桃橙", color: "#F5D6B8" },
  { id: "coral", name: "珊瑚红", color: "#F3CBC7" },
  { id: "pink", name: "樱花粉", color: "#EECDE0" },
  { id: "lavender", name: "薰衣草紫", color: "#DCD0EF" },
  { id: "blue", name: "雾蓝", color: "#CAD8F0" },
  { id: "sky", name: "天空蓝", color: "#C7E4F2" },
  { id: "aqua", name: "湖水青", color: "#C7E7E4" },
  { id: "sand", name: "沙棕", color: "#E8D9C5" },
  { id: "silver", name: "银灰", color: "#DCE1E6" }
].map(Object.freeze));
var TagWorkspaceService = class {
  constructor(zotero, core, version = "1.0.1") {
    this.z = zotero;
    this.core = core;
    this.version = version;
    this.windows = new Map();
    this.embedded = new Map();
    this.contextListeners = new Map();
    this.panel = null;
    this.floating = null;
    this.undoEntry = null;
    this.pending = null;
    this.stopping = false;
    this.preference = "tagWorkspace.presets.v1";
  }
  attach(win) {
    if (this.stopping || this.windows.has(win)) return;
    const doc = win.document;
    const nodes = [];
    // Install icon geometry synchronously, before connecting the toolbar button.
    // An external stylesheet can arrive after the 500px PNG's first paint.
    const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = "better-tags-toolbar-style";
    style.textContent = `
      #tag-workspace-button { position:static; flex:0 0 auto; min-width:28px; padding:2px; list-style-image:url("chrome://tag-workspace/content/icons/better-tags.png"); }
      #tag-workspace-button > .toolbarbutton-icon { width:24px; height:24px; margin:0; object-fit:contain; }
      #tag-workspace-button > .toolbarbutton-text { display:none; }
    `;
    doc.documentElement.append(style);
    nodes.push(style);
    const add = (parent, kind, id, label, context = false, before = null) => {
      if (!parent) return;
      const node = doc.createXULElement(kind);
      node.id = id;
      node.setAttribute("label", label);
      node.setAttribute("tooltiptext", "按多个标签筛选整个文库，批量整理文献标签");
      if (kind === "toolbarbutton") {
        node.setAttribute("class", "zotero-tb-button");
        node.setAttribute("image", "chrome://tag-workspace/content/icons/better-tags.png");
        node.setAttribute("aria-label", "Better Tags");
        node.setAttribute("tooltiptext", "Better Tags · 按标签筛选和整理文献");
      }
      node.addEventListener("command", () => this.open(win, context));
      parent.insertBefore(node, before);
      nodes.push(node);
    };
    add(doc.getElementById("menu_ToolsPopup"), "menuitem", "tag-workspace-menu", "Better Tags…");
    const toolbar = doc.getElementById("zotero-items-toolbar");
    // Join the normal button flow after native actions and existing plugin
    // buttons, before the flexible space leading to Zotero's search field.
    const boundary = toolbar && ([...toolbar.children].find(node => node.localName === "spacer" && node.getAttribute("flex") === "1") ||
      [...toolbar.children].find(node => ["zotero-tb-search-spinner", "zotero-tb-search"].includes(node.id)));
    add(toolbar, "toolbarbutton", "tag-workspace-button", "Better Tags", false, boundary || null);
    add(doc.getElementById("zotero-itemmenu"), "menuitem", "tag-workspace-context", "用 Better Tags 整理所选条目…", true);
    const contextMenu = doc.getElementById("zotero-itemmenu");
    if (contextMenu) {
      const autoTag = doc.createXULElement("menuitem"); autoTag.id = "better-tags-auto-title";
      autoTag.setAttribute("label", "按标题自动添加已有标签");
      autoTag.setAttribute("tooltiptext", "使用当前文库已有标签，按完整短语匹配标题；忽略大小写，识别常见英文单复数");
      contextMenu.append(autoTag); nodes.push(autoTag);
      autoTag.addEventListener("command", () => this.autoTagSelected(win).catch(error => { this.z.logError(error); win.alert(error.message); }));
      const update = () => {
        const items = win.ZoteroPane.getSelectedItems(), libs = new Set(items.map(i => i.libraryID));
        autoTag.disabled = !items.length || libs.size !== 1 || !this.z.Libraries.get(items[0]?.libraryID)?.editable || !!this.pending;
      };
      contextMenu.addEventListener("popupshowing", update);
      this.contextListeners.set(win, { menu: contextMenu, update });
    }
    this.windows.set(win, nodes);
    const embedded = new TagWorkspaceEmbedded(this, win);
    this.embedded.set(win, embedded);
    embedded.ready.catch(error => this.z.logError(error));
  }
  detach(win) {
    const listener = this.contextListeners.get(win);
    if (listener) listener.menu.removeEventListener("popupshowing", listener.update);
    this.contextListeners.delete(win);
    this.embedded.get(win)?.dispose();
    this.embedded.delete(win);
    for (const node of this.windows.get(win) || []) node.remove();
    this.windows.delete(win);
  }
  open(owner, importSelection = false) {
    if (this.stopping) return null;
    const embedded = this.embedded.get(owner);
    if (!embedded) return null;
    embedded.ready.then(() => embedded.ui.guard(() => {
      if (importSelection) { embedded.setVisible(true); embedded.openBatch(); }
      else embedded.setVisible(!embedded.visible);
    }));
    return embedded;
  }
  mainWindow() {
    const win = this.floating?.owner || this.z.getMainWindow();
    if (!win || win.closed) throw new Error("请先打开 Zotero 主窗口。");
    return win;
  }
  libraries() {
    return this.z.Libraries.getAll().filter(l => l.libraryType !== "feed").map(l => ({
      id: l.libraryID, name: l.name, editable: l.editable
    }));
  }
  selectedFromMain(win, libraryID) {
    const items = win.ZoteroPane.getSelectedItems();
    return [...new Set(items.filter(i => i.libraryID === libraryID)
      .map(i => i.parentItemID || i.id))];
  }
  async records(libraryID) {
    const library = this.z.Libraries.get(libraryID);
    if (!library) throw new Error("该文库已不存在，请切换文库。");
    await library.waitForDataLoad("item");
    const items = (await this.z.Items.getAll(libraryID, true, false))
      .filter(i => i.isRegularItem() || i.isAttachment());
    await this.z.Items.loadDataTypes(items, ["itemData", "creators", "tags"]);
    return items.map(item => ({
      id: item.id,
      title: item.getField("title", false, true) || "（无标题）",
      creator: item.getField("firstCreator") || "",
      year: item.getField("year") || "",
      type: this.z.ItemTypes.getLocalizedString(item.itemTypeID),
      tags: item.getTags()
    }));
  }
  readPresets() {
    try {
      const values = JSON.parse(this.z.Prefs.get(this.preference) || "[]");
      if (!Array.isArray(values)) return [];
      return values.filter(v => v && typeof v.name === "string" && Number.isInteger(v.libraryID))
        .slice(0, 100).map(v => ({ ...v, state: this.core.normalizeState(v.state) }));
    } catch (error) {
      this.z.logError(error);
      return [];
    }
  }
  savePreset(name, libraryID, state) {
    name = name.trim();
    if (!name) throw new Error("请输入筛选组合名称。");
    if (name.length > 80) throw new Error("组合名称最多 80 个字符。");
    const entries = this.readPresets();
    if (entries.some(e => e.name === name && e.libraryID === libraryID)) {
      throw new Error("当前文库已有同名组合，请换一个名称，或先删除旧组合。");
    }
    if (entries.length >= 100) throw new Error("最多保存 100 个组合，请先删除不再使用的组合。");
    const preset = { id: this.z.Utilities.randomString(12), name, libraryID, state: this.core.normalizeState(state) };
    entries.push(preset);
    this.z.Prefs.set(this.preference, JSON.stringify(entries));
    return preset;
  }
  deletePreset(id) {
    this.z.Prefs.set(this.preference, JSON.stringify(this.readPresets().filter(e => e.id !== id)));
  }
  groupPreference(libraryID) {
    if (!Number.isInteger(libraryID) || !this.z.Libraries.get(libraryID)) throw new Error("无效文库。");
    return `tagWorkspace.groups.v1.${libraryID}`;
  }
  readGroups(libraryID) {
    const raw = this.z.Prefs.get(this.groupPreference(libraryID));
    try { return this.core.normalizeGroups(raw ? JSON.parse(raw) : []); }
    catch (error) {
      this.z.logError(error);
      throw new Error("分组设置无法读取。原数据已保留，请先备份设置再修复。");
    }
  }
  saveGroup(libraryID, change) {
    const nodes = this.readGroups(libraryID);
    if (change.id && !nodes.some(n => n.id === change.id)) throw new Error("该分组已不存在，请重新打开编辑窗口。");
    const id = change.id || this.z.Utilities.randomString(16);
    const result = this.core.upsertGroup(nodes, { ...change, id });
    this.z.Prefs.set(this.groupPreference(libraryID), JSON.stringify(result));
    return id;
  }
  deleteGroup(libraryID, id) {
    this.z.Prefs.set(this.groupPreference(libraryID), JSON.stringify(this.core.removeGroup(this.readGroups(libraryID), id)));
  }
  toggleGroup(libraryID, id) {
    const nodes = this.readGroups(libraryID);
    const node = nodes.find(n => n.id === id);
    if (node) node.collapsed = !node.collapsed;
    this.z.Prefs.set(this.groupPreference(libraryID), JSON.stringify(nodes));
  }
  reorderGroup(libraryID, id, targetID, after = false) {
    const nodes = this.core.reorderGroup(this.readGroups(libraryID), id, targetID, after);
    this.z.Prefs.set(this.groupPreference(libraryID), JSON.stringify(nodes));
  }
  tagColor(libraryID, tag) {
    const choice = this.tagColorChoice(libraryID, tag);
    return this.colorPalette.find(p => p.id === choice)?.color || this.automaticTagColor(libraryID, tag);
  }
  get colorPalette() { return TagWorkspacePalette; }
  readTagColorChoices(libraryID) {
    if (!this.colorChoices) this.colorChoices = new Map();
    if (!this.colorChoices.has(libraryID)) {
      let stored;
      try { stored = JSON.parse(this.z.Prefs.get(`tagWorkspace.tagColorChoices.v1.${libraryID}`) || "{}"); } catch (_) {}
      const entries = stored && typeof stored === "object" && !Array.isArray(stored) ? Object.entries(stored) : [];
      this.colorChoices.set(libraryID, new Map(entries.filter(([, id]) => this.colorPalette.some(p => p.id === id))));
    }
    return this.colorChoices.get(libraryID);
  }
  tagColorChoice(libraryID, tag) { return this.readTagColorChoices(libraryID).get(tag) || null; }
  setTagColor(libraryID, tag, choice) {
    this.groupPreference(libraryID); // Validate the library; this is a local UI preference.
    if (typeof tag !== "string" || !tag) throw new Error("标签名称无效。");
    if (choice !== null && !this.colorPalette.some(p => p.id === choice)) throw new Error("请选择提供的预设颜色。");
    const choices = this.readTagColorChoices(libraryID);
    if (choice === null) choices.delete(tag); else choices.set(tag, choice);
    this.z.Prefs.set(`tagWorkspace.tagColorChoices.v1.${libraryID}`, JSON.stringify(Object.fromEntries(choices)));
    for (const ctl of this.embedded.values()) if (!ctl.disposed && ctl.ui?.libraryID === libraryID) ctl.render();
  }
  automaticTagColor(libraryID, tag) {
    const key = `tagWorkspace.tagColors.v1.${libraryID}`;
    if (!this.tagColors) this.tagColors = new Map();
    if (!this.tagColors.has(libraryID)) {
      let stored;
      try { stored = JSON.parse(this.z.Prefs.get(key) || "{}"); } catch (_) {}
      const entries = stored && typeof stored === "object" && !Array.isArray(stored) ? Object.entries(stored) : [];
      this.tagColors.set(libraryID, new Map(entries.filter(([, value]) => Number.isInteger(value) && value >= 0 && value < 360)));
    }
    const colors = this.tagColors.get(libraryID);
    if (!colors.has(tag)) {
      colors.set(tag, Math.floor(Math.random() * 360));
      this.z.Prefs.set(key, JSON.stringify(Object.fromEntries(colors)));
    }
    return `hsl(${colors.get(tag)}, 65%, 91%)`;
  }
  async withWrite(operation) {
    if (this.stopping) throw new Error("插件正在关闭。");
    if (this.pending) throw new Error("请等待当前标签修改完成。");
    this.pending = operation();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async renameTag(libraryID, oldName, newName, merge = false) {
    newName = String(newName || "").trim().normalize("NFC");
    if (!this.z.Libraries.get(libraryID)?.editable) throw new Error("当前文库为只读，不能修改标签。");
    if (!newName || newName.length > 255 || /[\r\n\u0000]/.test(newName)) throw new Error("标签名称需为 1–255 个字符，且不能包含换行。");
    if (oldName === newName) return { name: newName, count: 0 };
    return this.withWrite(async () => {
      const rename = tags => [...new Set(tags.map(tag => tag === oldName ? newName : tag))];
      const readPresets = () => {
        const values = JSON.parse(this.z.Prefs.get(this.preference) || "[]");
        if (!Array.isArray(values)) throw new Error("常用组合设置无法读取，请先修复设置后再改名。");
        return values;
      };
      // Validate local settings before changing Zotero's native tags.
      this.readGroups(libraryID); readPresets();
      const affected = [...this.embedded.values()].filter(c => !c.disposed && c.ui?.libraryID === libraryID);
      for (const ctl of affected) { ctl.renaming = true; ctl.loadID++; ctl.owner.clearTimeout(ctl.loadTimer); }
      let renamed = false;
      try {
        const id = this.z.Tags.getID(oldName);
        const ids = id ? await this.z.Tags.getTagItems(libraryID, id) : [];
        if (!ids.length) throw new Error("此标签已不存在，请关闭窗口后重新选择。");
        const targetID = this.z.Tags.getID(newName);
        const merging = targetID && (await this.z.Tags.getTagItems(libraryID, targetID)).length > 0;
        if (!merge && merging) {
          const error = new Error(`「${newName}」已存在。勾选合并后可继续。`);
          error.code = "TAG_MERGE_REQUIRED"; throw error;
        }
        const count = ids.length;
        // Zotero's API owns its transactions. Wrapping it in another transaction
        // deadlocks, since Zotero serializes (rather than nests) transactions.
        await this.z.Tags.rename(libraryID, oldName, newName);
        const groups = this.readGroups(libraryID).map(g => ({ ...g, tags: rename(g.tags) }));
        const presets = readPresets().map(p => p?.libraryID === libraryID && p.state
          ? { ...p, state: { ...p.state, tags: rename(this.core.normalizeState(p.state).tags) } } : p);
        this.z.Prefs.set(this.groupPreference(libraryID), JSON.stringify(groups));
        this.z.Prefs.set(this.preference, JSON.stringify(presets));
        this.automaticTagColor(libraryID, oldName);
        const colors = this.tagColors.get(libraryID);
        if (!colors.has(newName)) colors.set(newName, colors.get(oldName));
        colors.delete(oldName);
        this.z.Prefs.set(`tagWorkspace.tagColors.v1.${libraryID}`, JSON.stringify(Object.fromEntries(colors)));
        const choices = this.readTagColorChoices(libraryID);
        if (!merging && choices.has(oldName)) choices.set(newName, choices.get(oldName));
        choices.delete(oldName);
        this.z.Prefs.set(`tagWorkspace.tagColorChoices.v1.${libraryID}`, JSON.stringify(Object.fromEntries(choices)));
        if (this.undoEntry?.libraryID === libraryID) this.undoEntry = null;
        for (const ctl of affected) {
          if (ctl.disposed || ctl.ui.libraryID !== libraryID) continue;
          ctl.ui.state.tags = rename(ctl.ui.state.tags); ctl.ui.groups = groups;
          if (ctl.ui.groupMemberSelection && ctl.ui.editingLibraryID === libraryID) {
            ctl.ui.groupMemberSelection = new Set(rename([...ctl.ui.groupMemberSelection]));
          }
        }
        renamed = true;
        return { name: newName, count };
      } finally {
        for (const ctl of affected) {
          ctl.renaming = false; ctl.scheduleLoad();
          if (renamed && !ctl.disposed && ctl.ui.libraryID === libraryID) ctl.queueApply(false);
        }
      }
    });
  }
  async checkedItems(libraryID, ids) {
    const library = this.z.Libraries.get(libraryID);
    if (!library?.editable) throw new Error("当前文库为只读，不能修改标签。");
    if (!ids.length) throw new Error("请先勾选要整理的条目。");
    const items = await this.z.Items.getAsync([...new Set(ids)]);
    if (items.length !== new Set(ids).size || items.some(i => !i || i.deleted || i.libraryID !== libraryID ||
      !i.isTopLevelItem() || !(i.isRegularItem() || i.isAttachment()))) {
      throw new Error("所选条目已变化或不属于当前文库，请等待列表自动更新后重新选择。");
    }
    await this.z.Items.loadDataTypes(items, ["tags"]);
    if (items.some(i => i.hasChanged())) {
      throw new Error("部分条目还有尚未保存的修改，请等待 Zotero 保存后重试。");
    }
    return items;
  }
  async writePlans(makePlans) {
    let plans = [];
    try {
      await this.z.DB.executeTransaction(async () => {
        // Read and plan after acquiring the transaction so a queued sync/write
        // cannot be overwritten by a plan made against older in-memory tags.
        plans = await makePlans();
        for (const plan of plans) {
          plan.item.setTags(plan.tags);
          await plan.item.save();
        }
      });
    } catch (error) {
      // Restore cached objects as well as the rolled-back database.
      for (const plan of plans) {
        try {
          // Zotero 10 keeps pending tag values separately from loaded tags.
          plan.item._clearChanged("tags");
          await plan.item.reload(["tags"], true);
        } catch (reloadError) { this.z.logError(reloadError); }
      }
      throw error;
    }
    return plans;
  }
  async changeTags(libraryID, ids, text, action) {
    if (!["add", "remove"].includes(action)) throw new Error("未知标签操作。");
    const names = this.core.parseTags(text);
    if (!names.length) throw new Error("请输入至少一个标签，每行一个。");
    if (names.some(n => n.length > 255)) throw new Error("单个标签最多 255 个字符。");
    return this.withWrite(async () => {
      const plans = await this.writePlans(async () => {
        const items = await this.checkedItems(libraryID, ids);
        return items.map(item => ({ item, ...this.core.planChange(item.getTags(), names, action) }))
          .filter(p => p.changes.length);
      });
      if (plans.length) this.undoEntry = {
        libraryID, changes: plans.map(p => ({ id: p.item.id, changes: p.changes }))
      };
      return plans.length;
    });
  }
  async undo() {
    return this.withWrite(async () => {
      const entry = this.undoEntry;
      if (!entry) throw new Error("没有可撤销的标签修改。");
      const plans = await this.writePlans(async () => {
        const items = await this.checkedItems(entry.libraryID, entry.changes.map(c => c.id));
        const changes = new Map(entry.changes.map(c => [c.id, c.changes]));
        return items.map(item => ({ item,
          tags: this.core.planUndo(item.getTags(), changes.get(item.id)) }));
      });
      this.undoEntry = null;
      return plans.length;
    });
  }
  async autoTagSelected(win) {
    const selected = win.ZoteroPane.getSelectedItems();
    const libraries = new Set(selected.map(item => item.libraryID));
    if (libraries.size !== 1) throw new Error("请在同一个文库中选择要添加标签的条目。");
    const libraryID = selected[0].libraryID;
    const result = await this.autoTagByTitle(libraryID, this.selectedFromMain(win, libraryID), win.document);
    const message = result.added ? `已检查 ${result.checked} 篇：为 ${result.changed} 篇文献新增 ${result.added} 个标签。`
      : `已检查 ${result.checked} 篇，没有需要新增的匹配标签。`;
    this.embedded.get(win)?.ui?.status(message);
    const progress = new this.z.ProgressWindow({ window: win, closeOnClick: true });
    progress.changeHeadline("Better Tags"); progress.addDescription(message); progress.show(); progress.startCloseTimer(4000);
    return result;
  }
  async autoTagByTitle(libraryID, ids, document) {
    return this.withWrite(async () => {
      let checked = 0;
      const plans = await this.writePlans(async () => {
        const items = await this.checkedItems(libraryID, ids); checked = items.length;
        await this.z.Items.loadDataTypes(items, ["itemData"]);
        // Snapshot only tags already present on live top-level items in this
        // library, matching the vocabulary shown in Better Tags navigation.
        const existing = this.core.facets(await this.records(libraryID)).map(f => f.tag);
        const match = this.core.compileTagMatcher(existing);
        return items.map(item => ({ item, ...this.core.planChange(item.getTags(),
          match(TagWorkspaceTitles.plain(document, item.getField("title", false, true))), "add") }))
          .filter(plan => plan.changes.length);
      });
      if (plans.length) this.undoEntry = { libraryID, changes: plans.map(p => ({ id: p.item.id, changes: p.changes })) };
      return { checked, changed: plans.length, added: plans.reduce((n, p) => n + p.changes.length, 0) };
    });
  }
  async locate(id) {
    const win = this.mainWindow();
    await win.ZoteroPane.selectItems([id], { inLibraryRoot: true });
    win.focus();
  }
  async read(id) {
    const item = await this.z.Items.getAsync(id);
    if (!item || item.deleted) throw new Error("条目已不存在，请选择其他文献。");
    const win = this.mainWindow();
    await win.ZoteroPane.viewItems([item]);
    win.focus();
  }
  async destroy() {
    this.stopping = true;
    if (this.pending) { try { await this.pending; } catch (e) { this.z.logError(e); } }
    for (const win of [...this.windows.keys()]) this.detach(win);
    this.panel = null;
    this.undoEntry = null;
  }
};

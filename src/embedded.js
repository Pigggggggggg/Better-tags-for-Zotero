"use strict";
// Only window-owned rows are adapted. Native searches, advanced-search objects,
// item rendering, selection, context menus and reader actions remain Zotero's.
var TagWorkspaceEmbedded = class {
  constructor(service, owner) {
    this.service = service; this.z = service.z; this.core = service.core;
    this.owner = owner; this.doc = owner.document;
    this.disposed = false; this.rowHooks = new Map(); this.nodes = [];
    this.idle = Promise.resolve(); this.loadID = 0; this.scopeMode = "library";
    this.ready = this.init();
  }
  $(id) { return this.doc.getElementById(`better-tags-${id}`); }
  element(tag, className, text) {
    const node = this.doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  mount(markup, parent, before = null) {
    const parsed = new this.owner.DOMParser().parseFromString(markup, "text/html");
    const nodes = [...parsed.body.children].map(n => this.doc.importNode(n, true));
    for (const node of nodes) { parent.insertBefore(node, before); this.nodes.push(node); }
  }
  rows() { return this.view?.collectionTreeRows || []; }
  currentLibrary(rows = this.rows()) {
    const ids = [...new Set(rows.map(r => r.ref?.libraryID).filter(Number.isInteger))];
    return ids.length === 1 ? ids[0] : null;
  }
  supported(rows = this.rows()) {
    return !!rows.length && !!this.currentLibrary(rows) && rows.every(r =>
      (r.isLibrary(true) && !r.isFeed?.()) || r.isCollection() || r.isSearch());
  }
  active(row) {
    const s = this.ui?.state;
    return !this.disposed && this.supported() && row.ref?.libraryID === this.ui.libraryID &&
      !!(s.tags.length || s.groupID || s.untagged);
  }
  async init() {
    await this.z.initializationPromise;
    for (let i = 0; !this.owner.ZoteroPane?.itemsView && i < 400 && !this.disposed; i++) {
      await new Promise(resolve => this.owner.setTimeout(resolve, 50));
    }
    if (this.disposed) return;
    this.pane = this.owner.ZoteroPane; this.view = this.pane.itemsView;
    if (!this.view) throw new Error("Better Tags：文献列表尚未就绪。");
    this.container = this.doc.getElementById("zotero-tag-selector-container");
    this.nativeTags = this.doc.getElementById("zotero-tag-selector");
    this.splitter = this.doc.getElementById("zotero-tags-splitter");
    this.original = { collapsed: this.container.getAttribute("collapsed"), height: this.container.getAttribute("height"),
      splitState: this.splitter.getAttribute("state"), nativeDisplay: this.nativeTags.style.display };
    const style = this.element("link"); style.rel = "stylesheet";
    style.href = `chrome://tag-workspace/content/embedded.css?v=${encodeURIComponent(this.service.version)}`;
    this.doc.documentElement.append(style); this.nodes.push(style);
    this.nativeTags.style.display = "none";
    this.container.classList.add("better-tags-container");
    const groupScope = { document: this.doc, TagWorkspaceCore: this.core, setTimeout: this.owner.setTimeout.bind(this.owner) };
    Services.scriptloader.loadSubScript("chrome://tag-workspace/content/groups.js", groupScope);
    const self = this;
    this.ui = {
      ...groupScope.TagWorkspaceGroups,
      service: this.service, groups: [], records: [], state: this.core.normalizeState(), tagLimit: 250,
      libraryID: this.currentLibrary() || this.z.Libraries.userLibraryID,
      $: id => self.$(id), element: (...args) => self.element(...args),
      button(text, cls, action) {
        const node = self.element("button", cls, text); node.type = "button";
        node.addEventListener("click", event => this.guard(() => action(event))); return node;
      },
      async guard(action) {
        try { return await action(); } catch (error) { self.z.logError(error); this.status(error.message || String(error), true); }
      },
      status(text, error = false) {
        if (self.disposed) return;
        self.$("status").textContent = text; self.$("status").classList.toggle("error-text", error);
      },
      flushQuery() {},
      tagClick(tag, event) { event.preventDefault(); event.stopPropagation(); this.toggleTag(tag, event.altKey || event.ctrlKey); },
      toggleTag(tag, additive = false) {
        this.state = self.core.selectTag(this.state, tag, additive);
        this.apply();
      },
      apply() {
        this.state = self.core.normalizeState(this.state);
        if (this.state.groupID && !this.groups.some(g => g.id === this.state.groupID)) this.state.groupID = null;
        self.render(); self.queueApply(); return "";
      },
      renderTags() {
        const facets = self.core.facets(this.records, self.$("manual-only").checked);
        self.$("tag-count").textContent = `${facets.length}`;
        this.renderGroupTree(facets, self.$("tag-search").value.trim().toLocaleLowerCase());
      }
    };
    this.mount(`<section id="better-tags-panel" aria-label="Better Tags 标签导航">
      <header><img src="chrome://tag-workspace/content/icons/better-tags.png" width="20" height="20" alt=""/><strong>Better Tags</strong><span id="better-tags-tag-count" class="muted"></span><button id="better-tags-hide" class="icon-button" aria-label="收起标签面板" title="收起面板，保留筛选">⌄</button></header>
      <div class="tag-search-row"><input id="better-tags-tag-search" type="search" placeholder="查找标签或分组…" aria-label="查找标签或分组"/><button id="better-tags-new-group" class="circle-button" title="新建分组">New</button></div>
      <div class="options"><select id="better-tags-scope" aria-label="标签筛选范围"><option value="library">整个文库</option><option value="current">当前分类</option></select><label class="checkline"><input id="better-tags-manual-only" type="checkbox"/>手动标签</label></div>
      <div id="better-tags-tag-list" class="tag-list"></div>
      <details class="presets"><summary>常用组合</summary><div id="better-tags-presets"></div><button id="better-tags-save-preset" class="wide">保存当前筛选</button></details>
      <div class="panel-footer"><button id="better-tags-batch-open">整理所选</button><span class="muted" title="单击切换；Ctrl 或 Alt＋单击多选；右键标签可改名">Ctrl / Alt 多选</span></div>
      <div id="better-tags-status" role="status" aria-live="polite"></div>
    </section>`, this.container);
    this.$("panel").betterTagsController = this;
    const items = this.doc.getElementById("zotero-items-pane-container");
    this.mount(`<section id="better-tags-conditions" aria-label="Better Tags 筛选条件">
      <button id="better-tags-show" class="icon-button" title="显示／收起标签面板"><img src="chrome://tag-workspace/content/icons/better-tags.png" width="20" height="20" alt="Better Tags"/></button>
      <div class="match-modes"><button id="better-tags-mode-all" class="circle-button" title="同时满足全部标签">All</button><button id="better-tags-mode-any" class="circle-button" title="满足任一标签">ANY</button></div>
      <div id="better-tags-selected-tags" class="selected-tags"></div><button id="better-tags-clear">清空标签</button>
      <label class="checkline"><input id="better-tags-untagged" type="checkbox"/>未打标签</label><span id="better-tags-scope-note" class="muted"></span>
    </section>`, items, this.doc.getElementById("zotero-items-pane"));
    this.mount(this.dialogMarkup(), this.doc.documentElement);
    this.bind(); this.ui.bindGroups(); this.installHooks();
    this.setVisible(this.z.Prefs.get("tagWorkspace.embeddedVisible") !== false);
    this.initSizing();
    // Import any active native tag selection before replacing its visible controls.
    const nativeSelection = this.pane.tagSelector?.getTagSelection();
    if (nativeSelection?.size) {
      this.ui.state.tags = [...nativeSelection];
      this.pane.tagSelector.clearTagSelection();
      await this.view.setFilter("tags", new Set());
    }
    await this.load();
    if (this.ui.state.tags.length) this.queueApply();
    this.observer = this.z.Notifier.registerObserver({ notify: () => this.scheduleLoad() }, ["item", "item-tag", "tag", "group"], "better-tags-embedded");
    this.focusListener = () => this.scheduleLoad(); this.owner.addEventListener("focus", this.focusListener);
    this.visibilityObserver = new this.owner.MutationObserver(() => this.syncVisibility());
    this.visibilityObserver.observe(this.container, { attributes: true, attributeFilter: ["collapsed"] });
    this.render();
  }
  dialogMarkup() {
    return `<dialog id="better-tags-group-dialog" class="better-tags-dialog"><h2 id="better-tags-group-dialog-title">新建标签分组</h2>
      <div class="group-fields"><div><label for="better-tags-group-name">分组名称</label><input id="better-tags-group-name" maxlength="80"/></div><div><label for="better-tags-group-parent">父分组</label><select id="better-tags-group-parent"></select></div></div>
      <label for="better-tags-group-tag-search">选择放入本组的标签</label><input id="better-tags-group-tag-search" type="search" placeholder="搜索已有标签…"/>
      <p id="better-tags-group-member-count" class="caption"></p><div id="better-tags-group-members"></div><p class="caption">同一标签可放入多个组；分组保存在本机。</p><p id="better-tags-group-error" class="error-text"></p>
      <div class="dialog-actions"><button id="better-tags-delete-group" class="danger">删除分组…</button><span class="spacer"></span><button id="better-tags-cancel-group">取消</button><button id="better-tags-save-group" class="primary">保存分组</button></div></dialog>
      <dialog id="better-tags-delete-group-dialog" class="better-tags-dialog"><h2>删除分组结构</h2><p id="better-tags-delete-group-description"></p><div class="dialog-actions"><button id="better-tags-cancel-delete-group">取消</button><button id="better-tags-confirm-delete-group" class="danger">确认删除分组</button></div></dialog>
      <dialog id="better-tags-preset-dialog" class="better-tags-dialog"><h2>保存筛选组合</h2><label for="better-tags-preset-name">组合名称</label><input id="better-tags-preset-name" maxlength="80"/><p id="better-tags-preset-error" class="error-text"></p><div class="dialog-actions"><button id="better-tags-cancel-preset">取消</button><button id="better-tags-confirm-preset" class="primary">保存</button></div></dialog>
      <dialog id="better-tags-batch-dialog" class="better-tags-dialog"><h2>整理所选条目的标签</h2><p id="better-tags-batch-count"></p><textarea id="better-tags-tag-input" rows="4" placeholder="每行一个标签" aria-label="每行一个标签"></textarea><p id="better-tags-batch-message" role="status"></p><div class="dialog-actions"><button id="better-tags-undo">撤销上次修改</button><span class="spacer"></span><button id="better-tags-batch-close">关闭</button><button id="better-tags-remove-tags">移除…</button><button id="better-tags-add-tags" class="primary">添加</button></div></dialog>
      <dialog id="better-tags-rename-dialog" class="better-tags-dialog"><h2>重命名标签</h2><p id="better-tags-rename-old"></p><label for="better-tags-rename-name">新名称</label><input id="better-tags-rename-name" maxlength="255"/><p class="caption">修改当前文库中所有使用此标签的条目，并同步更新分组和常用组合。</p><label id="better-tags-rename-merge-row" class="checkline" hidden><input id="better-tags-rename-merge" type="checkbox"/>与现有同名标签合并</label><p id="better-tags-rename-error" class="error-text" role="alert"></p><div class="dialog-actions"><button id="better-tags-rename-cancel">取消</button><button id="better-tags-rename-save" class="primary">保存</button></div></dialog>
      <dialog id="better-tags-color-dialog" class="better-tags-dialog"><h2>标签颜色</h2><span id="better-tags-color-preview"></span><div id="better-tags-color-options" role="radiogroup" aria-label="预设标签颜色"></div><p class="caption">仅设置 Better Tags 中的标签底色，同名标签在各分组中保持一致。</p><p id="better-tags-color-error" class="error-text" role="alert"></p><div class="dialog-actions"><button id="better-tags-color-auto">自动配色</button><span class="spacer"></span><button id="better-tags-color-cancel">取消</button><button id="better-tags-color-save" class="primary">保存</button></div></dialog>`;
  }
  bind() {
    const click = (id, action) => this.$(id).addEventListener("click", () => this.ui.guard(action));
    click("hide", () => this.setVisible(false)); click("show", () => this.setVisible(!this.visible));
    click("mode-all", () => { this.ui.state.mode = "all"; this.ui.apply(); });
    click("mode-any", () => { this.ui.state.mode = "any"; this.ui.apply(); });
    click("clear", () => { this.ui.state = this.core.normalizeState(); this.render(); this.queueApply(false); });
    this.$("untagged").addEventListener("change", () => { this.ui.state.untagged = this.$("untagged").checked; if (this.ui.state.untagged) { this.ui.state.tags = []; this.ui.state.groupID = null; } this.ui.apply(); });
    this.$("tag-search").addEventListener("input", () => { this.ui.tagLimit = 250; this.ui.renderTags(); });
    this.$("manual-only").addEventListener("change", () => this.ui.renderTags());
    this.$("scope").addEventListener("change", () => { this.scopeMode = this.$("scope").value; this.ui.apply(); });
    for (const type of ["keydown", "keyup"]) this.$("panel").addEventListener(type, event => { if (event.key === "Alt") { event.preventDefault(); event.stopPropagation(); } });
    click("batch-open", () => this.openBatch()); click("batch-close", () => { if (!this.busy) this.$("batch-dialog").close(); });
    this.$("batch-dialog").addEventListener("cancel", e => { if (this.busy) e.preventDefault(); });
    click("add-tags", () => this.edit("add")); click("remove-tags", () => this.edit("remove")); click("undo", () => this.edit("undo"));
    click("save-preset", () => { this.$("preset-name").value = ""; this.$("preset-error").textContent = ""; this.$("preset-dialog").showModal(); this.$("preset-name").focus(); });
    click("cancel-preset", () => this.$("preset-dialog").close());
    click("confirm-preset", () => {
      try {
        this.service.savePreset(this.$("preset-name").value, this.ui.libraryID, { ...this.ui.state, query: this.doc.getElementById("zotero-tb-search").searchTextbox.value });
        this.$("preset-dialog").close(); this.renderPresets();
      } catch (error) { this.$("preset-error").textContent = error.message; }
    });
    this.bindRename();
  }
  setVisible(value) {
    if (this.disposed) return;
    this.visible = !!value;
    this.container.setAttribute("collapsed", String(!this.visible));
    this.splitter.setAttribute("state", this.visible ? "open" : "collapsed");
    this.syncVisibility();
  }
  syncVisibility() {
    if (this.disposed) return;
    this.visible = this.container.getAttribute("collapsed") !== "true";
    this.z.Prefs.set("tagWorkspace.embeddedVisible", this.visible);
    this.doc.getElementById("tag-workspace-button")?.setAttribute("aria-pressed", String(this.visible));
    this.$("show")?.setAttribute("aria-expanded", String(this.visible));
    if (this.visible) this.applyHeightRatio();
  }
  sizingHeight() {
    if (!this.sidebar?.clientHeight) return 0;
    const reserved = [...this.sidebar.children].filter(n => n !== this.container && n !== this.folderTree)
      .reduce((sum, n) => {
        const css = this.owner.getComputedStyle(n);
        return sum + n.getBoundingClientRect().height + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
      }, 0);
    return Math.max(0, this.sidebar.clientHeight - reserved);
  }
  initSizing() {
    this.sidebar = this.container.parentElement;
    this.folderTree = this.doc.getElementById("zotero-collections-tree-container");
    this.original.minHeight = this.container.style.minHeight;
    this.original.maxHeight = this.container.style.maxHeight;
    this.original.cssHeight = this.container.style.height;
    this.original.flexShrink = this.container.style.flexShrink;
    this.original.treeMinHeight = this.folderTree.style.minHeight;
    const saved = Number(this.z.Prefs.get("tagWorkspace.embeddedHeightRatio.v1"));
    const available = this.sizingHeight();
    const legacy = Number(this.z.Prefs.get("tagWorkspace.embeddedHeight"));
    this.heightRatio = saved > 0 && saved < 1 ? saved : available > 0 && legacy > 0 ? legacy / available : .55;
    this.heightRatio = Math.min(.95, Math.max(.05, this.heightRatio));
    this.saveHeightRatio();
    this.applyHeightRatio();
    // Only explicit divider dragging changes the preferred ratio. Window resize,
    // maximize/restore, toolbar layout, hiding and showing must never rewrite it.
    this.splitterDown = event => {
      if (event.button !== 0) return;
      this.applyHeightRatio(); this.sizingDrag = true;
    };
    this.splitterUp = () => {
      if (!this.sizingDrag) return;
      this.owner.clearTimeout(this.sizingFrame);
      this.sizingFrame = this.owner.setTimeout(() => {
        if (!this.disposed && this.visible) {
          const available = this.sizingHeight(), height = this.container.getBoundingClientRect().height;
          if (available > 0 && height > 0) {
            this.heightRatio = Math.min(.95, Math.max(.05, height / available));
            this.saveHeightRatio();
            this.z.Prefs.set("tagWorkspace.embeddedHeight", Math.round(height));
          }
        }
        this.sizingDrag = false; this.applyHeightRatio();
      }, 0);
    };
    this.splitter.addEventListener("mousedown", this.splitterDown, true);
    this.owner.addEventListener("mouseup", this.splitterUp, true);
    this.owner.addEventListener("blur", this.splitterUp);
    this.resizeObserver = new this.owner.ResizeObserver(() => this.applyHeightRatio());
    for (const node of [this.sidebar, ...this.sidebar.children]) this.resizeObserver.observe(node);
    this.windowResize = () => this.applyHeightRatio();
    this.owner.addEventListener("resize", this.windowResize);
  }
  saveHeightRatio() {
    this.z.Prefs.set("tagWorkspace.embeddedHeightRatio.v1", this.heightRatio.toFixed(6));
  }
  applyHeightRatio() {
    if (this.disposed || !this.visible || !this.heightRatio || this.sizingDrag) return;
    const available = this.sizingHeight();
    if (available <= 0) return;
    const reserve = Math.min(32, available * .1);
    const maximum = Math.max(0, available - reserve), minimum = Math.min(130, maximum);
    const target = Math.round(Math.min(maximum, Math.max(minimum, available * this.heightRatio)));
    this.container.style.minHeight = `${minimum}px`; this.container.style.maxHeight = `${maximum}px`;
    this.container.style.height = `${target}px`; this.container.style.flexShrink = "0";
    this.folderTree.style.minHeight = `${reserve}px`;
    if (this.container.getAttribute("height") !== String(target)) this.container.setAttribute("height", target);
  }
  installHooks() {
    const self = this, view = this.view;
    this.originalToggle = this.pane.toggleTagSelector;
    this.toggleHook = async function () {
      if (self.disposed) return self.originalToggle.call(this);
      self.setVisible(!self.visible);
      if (self.visible) self.$("tag-search").focus();
    };
    this.pane.toggleTagSelector = this.toggleHook;
    this.originalChange = view.changeCollectionTreeRows;
    this.changeHook = async function (rows) {
      if (!self.disposed) self.beforeRows(rows || []);
      const result = await self.originalChange.call(this, rows);
      if (!self.disposed) { self.renderScope(); self.scheduleLoad(); }
      return result;
    };
    view.changeCollectionTreeRows = this.changeHook;
    this.beforeRows(this.rows(), true);
    this.rowProvider = view.rowProvider;
    this.originalExpandMatches = this.rowProvider._expandMatchParents;
    this.expandMatchesHook = function (...args) {
      // Tag filtering needs native search refreshes, but every attachment under
      // a matching parent is not a reason to open that parent's disclosure row.
      if (self.rows().some(row => self.active(row)) && !self.nativeSearchActive()) return;
      return self.originalExpandMatches.apply(this, args);
    };
    this.rowProvider._expandMatchParents = this.expandMatchesHook;
    this.refreshListener = () => { if (!this.disposed) this.renderScope(); };
    view.onRefresh.addListener(this.refreshListener);
  }
  nativeSearchActive() {
    return this.rows().some(row => {
      const original = this.rowHooks.get(row)?.originalMode || row.isSearchMode;
      return original.call(row);
    });
  }
  beforeRows(rows, initial = false) {
    const libraryID = this.currentLibrary(rows);
    if (libraryID !== this.ui.libraryID || !this.supported(rows)) {
      this.ui.state = this.core.normalizeState(); this.ui.records = []; this.ui.groups = [];
      if (libraryID) this.ui.libraryID = libraryID;
      this.loadID++; this.loadedLibrary = null;
    }
    if (!initial && !this.selectingRoot) this.scopeMode = rows.every(r => r.isLibrary(true)) ? "library" : "current";
    for (const row of rows) {
      if (this.rowHooks.has(row)) continue;
      const original = row.getSearchObject, originalMode = row.isSearchMode, self = this;
      // Native item notifications otherwise use an unfiltered incremental path:
      // even an unrelated modified item could be appended while a reader is open.
      const modeHook = function (...args) { return self.active(this) || originalMode.apply(this, args); };
      const hook = async function (options = {}) {
        const search = await original.call(this, options);
        if (options.unfiltered || !self.active(this)) return search;
        // Intersect the native search output with matching top-level items. Native
        // child hits (PDF full text/notes) are retained when their parent matches.
        // getSearchResults still owns the result/temp-table caches and cleanup.
        const scoped = Object.create(search);
        scoped.search = async function (asTempTable = false) {
          const ids = await search.search(false);
          const filtered = await self.filterIDs(ids, row);
          return asTempTable ? self.z.Search.idsToTempTable(filtered) : filtered;
        };
        return scoped;
      };
      row.getSearchObject = hook; row.isSearchMode = modeHook; row.clearCache();
      this.rowHooks.set(row, { original, hook, originalMode, modeHook });
    }
  }
  async filterIDs(ids, row) {
    if (!this.active(row)) return ids;
    const items = await this.z.Items.getAsync(ids);
    const parents = new Map();
    for (const item of items) {
      let top = item;
      while (top.parentItemID) top = await this.z.Items.getAsync(top.parentItemID);
      parents.set(item.id, top);
    }
    const tops = [...new Map([...parents.values()].map(item => [item.id, item])).values()];
    await this.z.Items.loadDataTypes(tops, ["tags"]);
    if (!this.active(row)) return ids;
    const state = { ...this.ui.state, query: "" };
    const records = tops.filter(i => !i.deleted && (i.isRegularItem() || i.isAttachment())).map(i => ({ id: i.id, tags: i.getTags() }));
    const allowed = new Set(this.core.filter(records, state, this.core.groupTags(this.ui.groups, state.groupID)).map(r => r.id));
    return ids.filter(id => allowed.has(parents.get(id)?.id));
  }
  queueApply(ensureRoot = true) {
    this.idle = this.idle.catch(() => {}).then(async () => {
      if (this.disposed) return;
      // The hidden native selector can still receive tag actions from Zotero.
      // Keep only the conditions shown by Better Tags when the user filters here.
      this.pane.tagSelector?.clearTagSelection();
      for (const row of this.rows()) row.setTags(new Set());
      if (ensureRoot && this.scopeMode === "library") {
        const searchField = this.doc.getElementById("zotero-tb-search").searchTextbox;
        const query = searchField.value;
        this.selectingRoot = true;
        try { await this.pane.collectionsView.selectLibrary(this.ui.libraryID); } finally { this.selectingRoot = false; }
        if (searchField.value !== query) { searchField.value = query; await this.pane.search(); }
      }
      if (this.loadedLibrary !== this.ui.libraryID) await this.load();
      for (const row of this.rows()) row.clearCache();
      await this.view.refreshAndMaintainSelection();
      const filterKey = JSON.stringify([this.ui.libraryID, this.ui.state]);
      if (filterKey !== this.appliedTagFilter && this.rows().some(row => this.active(row)) && !this.nativeSearchActive()) {
        // A new tag selection starts folded; subsequent background refreshes
        // retain rows the user has explicitly opened.
        this.view.collapseAllRows(true);
      }
      this.appliedTagFilter = filterKey;
      this.renderScope();
    }).catch(error => { if (!this.disposed) { this.z.logError(error); this.ui.status(error.message, true); } });
    return this.idle;
  }
  scheduleLoad() {
    if (this.disposed || this.renaming) return;
    this.owner.clearTimeout(this.loadTimer);
    this.loadTimer = this.owner.setTimeout(() => { this.loadTimer = null; this.ui.guard(() => this.load()); }, 180);
  }
  async load() {
    if (this.disposed || this.renaming) return;
    const request = ++this.loadID, libraryID = this.ui.libraryID;
    const records = await this.service.records(libraryID);
    if (this.disposed || this.renaming || request !== this.loadID || libraryID !== this.ui.libraryID) return;
    const groups = this.service.readGroups(libraryID);
    const reconciled = this.core.reconcileState(this.ui.state, records);
    let changed = !!reconciled.removed.length;
    this.ui.state = reconciled.state;
    if (this.ui.state.groupID && !groups.some(g => g.id === this.ui.state.groupID)) { this.ui.state.groupID = null; changed = true; }
    this.ui.records = records; this.ui.groups = groups; this.loadedLibrary = libraryID;
    this.render(); this.renderPresets();
    this.ui.status(changed ? "已清理文库中不再存在的筛选条件。" : "");
    if (changed) this.queueApply(false);
  }
  renderScope() {
    if (this.disposed || !this.$("scope-note")) return;
    this.$("scope-note").textContent = this.rows().map(r => r.getName()).join(" · ");
    this.$("scope-note").title = `当前范围：${this.$("scope-note").textContent}`;
    this.$("scope").value = this.scopeMode;
    const supported = this.supported();
    this.$("tag-list").inert = !supported;
    for (const id of ["mode-all", "mode-any", "untagged"]) this.$(id).disabled = !supported;
    if (!supported) this.ui.status("请选择一个文库、分类或已保存的搜索来筛选标签。");
  }
  render() {
    if (this.disposed) return;
    const ui = this.ui;
    ui.renderTags();
    this.$("mode-all").setAttribute("aria-pressed", ui.state.mode === "all");
    this.$("mode-any").setAttribute("aria-pressed", ui.state.mode === "any");
    this.$("untagged").checked = ui.state.untagged;
    const chips = ui.state.tags.map(tag => {
      const chip = ui.button(`${tag} ×`, "chip", () => { ui.state.tags = ui.state.tags.filter(t => t !== tag); ui.apply(); });
      chip.dataset.tag = tag; chip.setAttribute("aria-label", `取消标签 ${tag}`);
      chip.style.setProperty("--tag-color", this.service.tagColor(ui.libraryID, tag)); return chip;
    });
    if (ui.state.groupID) chips.unshift(ui.button(`${this.core.groupPath(ui.groups, ui.state.groupID)} ×`, "chip group-chip", () => { ui.state.groupID = null; ui.apply(); }));
    if (!chips.length) chips.push(this.element("span", "muted", ui.state.untagged ? "未打标签" : "点击左侧标签开始筛选"));
    this.$("selected-tags").replaceChildren(...chips);
    this.renderScope();
  }
  renderPresets() {
    const rows = this.service.readPresets().filter(p => p.libraryID === this.ui.libraryID).map(preset => {
      const row = this.element("div", "preset-row");
      row.append(this.ui.button(preset.name, "preset-name", async () => {
        this.ui.state = this.core.reconcileState(preset.state, this.ui.records).state;
        this.ui.state.query = "";
        this.render(); await this.queueApply();
        const field = this.doc.getElementById("zotero-tb-search").searchTextbox;
        field.value = preset.state.query || ""; await this.pane.search();
      }), this.ui.button("×", "icon-button", () => { this.service.deletePreset(preset.id); this.renderPresets(); }));
      return row;
    });
    this.$("presets").replaceChildren(...rows);
  }
  openBatch() {
    this.batchRequest = { libraryID: this.ui.libraryID, ids: this.service.selectedFromMain(this.owner, this.ui.libraryID) };
    this.$("batch-count").textContent = `已选 ${this.batchRequest.ids.length} 篇文献 · 使用主列表中的选择`;
    this.$("batch-message").textContent = ""; this.$("tag-input").value = "";
    this.updateBatch(); this.$("batch-dialog").showModal(); this.$("tag-input").focus();
  }
  bindRename() {
    const popup = this.doc.createXULElement("menupopup"); popup.id = "better-tags-tag-menu";
    const item = this.doc.createXULElement("menuitem"); item.id = "better-tags-tag-rename";
    item.setAttribute("label", "重命名标签…"); popup.append(item);
    const color = this.doc.createXULElement("menuitem"); color.id = "better-tags-tag-color";
    color.setAttribute("label", "标签颜色…"); popup.append(color);
    color.addEventListener("command", () => this.ui.guard(() => this.openColor(this.contextTag)));
    this.doc.documentElement.append(popup); this.nodes.push(popup);
    item.addEventListener("command", () => this.ui.guard(() => this.openRename(this.contextTag)));
    for (const id of ["tag-list", "selected-tags"]) {
      this.$(id).addEventListener("contextmenu", event => {
        const target = event.target.closest("[data-tag]"); if (!target) return;
        event.preventDefault(); event.stopPropagation();
        this.contextTag = target.dataset.tag;
        item.disabled = !this.z.Libraries.get(this.ui.libraryID)?.editable;
        popup.openPopupAtScreen(event.screenX, event.screenY, true);
      });
      this.$(id).addEventListener("keydown", event => {
        const target = event.target.closest("[data-tag]");
        if (event.key === "F2" && target) { event.preventDefault(); event.stopPropagation(); this.ui.guard(() => this.openRename(target.dataset.tag)); }
      });
    }
    this.$("rename-cancel").addEventListener("click", () => { if (!this.renameBusy) this.$("rename-dialog").close(); });
    this.$("rename-dialog").addEventListener("cancel", event => { if (this.renameBusy) event.preventDefault(); });
    this.$("rename-save").addEventListener("click", () => this.saveRename());
    this.$("rename-name").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); this.saveRename(); } });
    this.$("rename-name").addEventListener("input", () => {
      this.$("rename-error").textContent = ""; this.$("rename-merge-row").hidden = true; this.$("rename-merge").checked = false;
      this.$("rename-save").textContent = "保存";
    });
    this.$("color-cancel").addEventListener("click", () => this.$("color-dialog").close());
    this.$("color-auto").addEventListener("click", () => { this.colorChoice = null; this.renderColorOptions(); });
    this.$("color-save").addEventListener("click", () => {
      try {
        if (this.colorRequest.libraryID !== this.ui.libraryID) throw new Error("文库已变化，请重新打开颜色窗口。");
        this.service.setTagColor(this.colorRequest.libraryID, this.colorRequest.tag, this.colorChoice);
        this.$("color-dialog").close();
      } catch (error) { this.$("color-error").textContent = error.message; }
    });
  }
  openColor(tag) {
    this.colorRequest = { libraryID: this.ui.libraryID, tag };
    this.colorChoice = this.service.tagColorChoice(this.ui.libraryID, tag);
    this.$("color-error").textContent = "";
    this.renderColorOptions(); this.$("color-dialog").showModal();
    (this.$("color-options").querySelector('[aria-checked="true"]') || this.$("color-auto")).focus();
  }
  renderColorOptions() {
    const { libraryID, tag } = this.colorRequest;
    const palette = this.service.colorPalette;
    this.$("color-preview").textContent = tag;
    this.$("color-preview").style.background = palette.find(p => p.id === this.colorChoice)?.color || this.service.automaticTagColor(libraryID, tag);
    this.$("color-auto").setAttribute("aria-pressed", String(this.colorChoice === null));
    this.$("color-options").replaceChildren(...palette.map(p => {
      const button = this.ui.button("", "color-choice", () => {
        this.colorChoice = p.id; this.renderColorOptions();
        this.$("color-options").querySelector('[aria-checked="true"]').focus();
      });
      button.dataset.color = p.id; button.style.background = p.color; button.setAttribute("role", "radio");
      button.setAttribute("aria-label", p.name);
      button.setAttribute("aria-checked", String(p.id === this.colorChoice));
      return button;
    }));
  }
  openRename(tag) {
    if (!this.z.Libraries.get(this.ui.libraryID)?.editable) throw new Error("当前文库为只读，不能修改标签。");
    this.renameRequest = { libraryID: this.ui.libraryID, oldName: tag };
    this.$("rename-old").textContent = `原名称：${tag}`;
    this.$("rename-name").value = tag; this.$("rename-error").textContent = "";
    this.$("rename-merge-row").hidden = true; this.$("rename-merge").checked = false;
    this.$("rename-save").textContent = "保存";
    this.$("rename-dialog").showModal(); this.$("rename-name").focus(); this.$("rename-name").select();
  }
  async saveRename() {
    if (this.renameBusy) return;
    const request = this.renameRequest;
    if (request.libraryID !== this.ui.libraryID) { this.$("rename-error").textContent = "文库已变化，请重新打开改名窗口。"; return; }
    this.renameBusy = true;
    for (const id of ["rename-save", "rename-cancel", "rename-name", "rename-merge"]) this.$(id).disabled = true;
    try {
      const result = await this.service.renameTag(request.libraryID, request.oldName, this.$("rename-name").value, this.$("rename-merge").checked);
      if (this.disposed) return;
      this.$("rename-dialog").close(); await this.load(); await this.queueApply(false);
      this.ui.status(`标签已改为「${result.name}」。`);
    } catch (error) {
      if (this.disposed) return;
      this.$("rename-error").textContent = error.message;
      if (error.code === "TAG_MERGE_REQUIRED") { this.$("rename-merge-row").hidden = false; this.$("rename-save").textContent = "合并并改名"; }
      else this.z.logError(error);
    } finally {
      this.renameBusy = false;
      if (!this.disposed) for (const id of ["rename-save", "rename-cancel", "rename-name", "rename-merge"]) this.$(id).disabled = false;
    }
  }
  updateBatch() {
    const editable = this.z.Libraries.get(this.batchRequest.libraryID)?.editable;
    for (const id of ["add-tags", "remove-tags"]) this.$(id).disabled = this.busy || !editable || !this.batchRequest.ids.length;
    this.$("undo").disabled = this.busy || !editable || this.service.undoEntry?.libraryID !== this.batchRequest.libraryID;
    this.$("batch-close").disabled = !!this.busy;
  }
  async edit(action) {
    if (this.busy) return;
    const request = { ...this.batchRequest, text: this.$("tag-input").value };
    if (action !== "undo" && !this.core.parseTags(request.text).length) { this.$("batch-message").textContent = "请输入标签，每行一个。"; return; }
    if (action === "remove" && !this.owner.confirm(`从选中的 ${request.ids.length} 篇文献移除以下标签？\n\n${request.text}\n\n完成后可撤销。`)) return;
    this.busy = true; this.updateBatch();
    try {
      const count = action === "undo" ? await this.service.undo() : await this.service.changeTags(request.libraryID, request.ids, request.text, action);
      this.$("batch-message").textContent = `已更新 ${count} 篇文献。`;
      await this.load(); await this.queueApply(false);
    } catch (error) { this.z.logError(error); this.$("batch-message").textContent = error.message; }
    finally { this.busy = false; this.updateBatch(); }
  }
  dispose() {
    this.disposed = true; this.loadID++;
    this.owner.clearTimeout(this.loadTimer);
    if (this.observer) this.z.Notifier.unregisterObserver(this.observer);
    if (this.focusListener) this.owner.removeEventListener("focus", this.focusListener);
    this.resizeObserver?.disconnect();
    this.owner.clearTimeout(this.sizingFrame);
    this.splitter?.removeEventListener("mousedown", this.splitterDown, true);
    this.owner.removeEventListener("mouseup", this.splitterUp, true);
    this.owner.removeEventListener("blur", this.splitterUp);
    this.owner.removeEventListener("resize", this.windowResize);
    this.visibilityObserver?.disconnect();
    if (this.pane?.toggleTagSelector === this.toggleHook) this.pane.toggleTagSelector = this.originalToggle;
    if (this.refreshListener) this.view.onRefresh.removeListener(this.refreshListener);
    if (this.view?.changeCollectionTreeRows === this.changeHook) this.view.changeCollectionTreeRows = this.originalChange;
    if (this.rowProvider?._expandMatchParents === this.expandMatchesHook) this.rowProvider._expandMatchParents = this.originalExpandMatches;
    for (const [row, { original, hook, originalMode, modeHook }] of this.rowHooks) {
      if (row.getSearchObject === hook) row.getSearchObject = original;
      if (row.isSearchMode === modeHook) row.isSearchMode = originalMode;
      row.clearCache();
    }
    if (this.container) {
      this.container.classList.remove("better-tags-container"); this.nativeTags.style.display = this.original.nativeDisplay;
      if (this.folderTree) {
        this.container.style.minHeight = this.original.minHeight;
        this.container.style.maxHeight = this.original.maxHeight;
        this.container.style.height = this.original.cssHeight;
        this.container.style.flexShrink = this.original.flexShrink;
        this.folderTree.style.minHeight = this.original.treeMinHeight;
      }
      const restore = (node, name, value) => value === null ? node.removeAttribute(name) : node.setAttribute(name, value);
      restore(this.container, "collapsed", this.original.collapsed); restore(this.container, "height", this.original.height); restore(this.splitter, "state", this.original.splitState);
    }
    for (const node of this.nodes) { if (node.localName === "dialog" && node.open) node.close(); node.remove(); }
    if (this.view && !this.owner.closed) this.view.refreshAndMaintainSelection().catch(error => this.z.logError(error));
  }
};

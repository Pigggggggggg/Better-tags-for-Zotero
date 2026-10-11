"use strict";
// A modeless overlay owned by the Zotero main window. The iframe keeps the
// workspace document isolated while the shell remains part of Zotero's UI.
var TagWorkspaceFloating = class {
  constructor(service, owner, args) {
    this.service = service;
    this.owner = owner;
    this.collapsed = false;
    this.closed = false;
    this.diameter = 42; // A generous hit area around the shared 16px line icon.
    const doc = owner.document;
    const html = (tag, id) => {
      const node = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (id) node.id = id;
      return node;
    };
    this.style = html("link");
    this.style.rel = "stylesheet";
    this.style.href = "chrome://tag-workspace/content/floating.css";
    doc.documentElement.append(this.style);
    this.host = html("section", "better-tags-floating");
    this.host.setAttribute("role", "region");
    this.host.setAttribute("aria-label", "Better Tags 浮窗");
    this.header = html("div", "better-tags-titlebar");
    this.title = html("span", "better-tags-title");
    this.title.textContent = "Better Tags";
    this.header.title = "拖动标题栏移动浮窗，双击折叠或展开";
    this.hint = html("span", "better-tags-drag-hint");
    this.hint.textContent = "";
    this.toggle = html("button", "better-tags-toggle");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-controls", "better-tags-frame");
    this.closeButton = html("button", "better-tags-close");
    this.closeButton.type = "button";
    this.setIcon(this.closeButton, "close");
    this.closeButton.title = "关闭浮窗 · 可从工具菜单重新打开";
    this.closeButton.setAttribute("aria-label", "关闭 Better Tags 浮窗");
    this.header.append(this.title, this.hint, this.toggle, this.closeButton);
    this.frame = html("iframe", "better-tags-frame");
    this.frame.title = "Better Tags 标签筛选与整理";
    this.frame.betterTagsContext = { ...args, floating: this };
    this.frame.setAttribute("src", "chrome://tag-workspace/content/workspace.xhtml");
    this.resizeHandle = html("div", "better-tags-resize");
    this.resizeHandle.title = "拖动调整浮窗大小；也可用方向键调整";
    this.resizeHandle.tabIndex = 0;
    this.resizeHandle.setAttribute("role", "button");
    this.resizeHandle.setAttribute("aria-label", "调整 Better Tags 浮窗大小");
    this.host.append(this.header, this.frame, this.resizeHandle);
    this.geometry = this.readGeometry();
    this.layout();
    this.updateToggle();
    this.toggle.addEventListener("click", e => {
      if (this.suppressClick) { this.suppressClick = false; e.preventDefault(); return; }
      this.setCollapsed(!this.collapsed);
    });
    this.closeButton.addEventListener("click", () => this.close());
    this.header.addEventListener("dblclick", e => {
      if (!e.target.closest("button")) this.setCollapsed(!this.collapsed);
    });
    this.bindDrag(this.header, false);
    this.bindDrag(this.toggle, false, true);
    this.bindDrag(this.resizeHandle, true);
    this.resizeHandle.addEventListener("keydown", e => {
      const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
      if (!delta) return;
      e.preventDefault();
      this.geometry.width += delta[0]; this.geometry.height += delta[1];
      this.layout(); this.saveGeometry();
    });
    this.onResize = () => this.layout();
    owner.addEventListener("resize", this.onResize);
    doc.documentElement.append(this.host);
  }
  get window() { return this.frame.contentWindow; }
  setIcon(button, name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = this.owner.document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = this.owner.document.createElementNS(ns, "path");
    const paths = { close: "M4 4L12 12M12 4L4 12", collapse: "M3 6L8 11L13 6", plus: "M8 3L8 13M3 8L13 8" };
    path.setAttribute("d", paths[name]);
    svg.append(path); button.replaceChildren(svg);
  }
  readGeometry() {
    let value;
    try { value = JSON.parse(this.service.z.Prefs.get("tagWorkspace.floating.v1") || "null"); } catch (_) {}
    const fallback = { width: 860, height: 600, left: this.owner.innerWidth - 884, top: 90 };
    if (!value || !["width", "height", "left", "top"].every(k => Number.isFinite(value[k]))) return fallback;
    return { width: value.width, height: value.height, left: value.left, top: value.top };
  }
  saveGeometry() {
    try { this.service.z.Prefs.set("tagWorkspace.floating.v1", JSON.stringify(this.geometry)); }
    catch (error) { this.service.z.logError(error); }
  }
  layout() {
    const margin = 10, top = Math.min(76, Math.max(10, this.owner.innerHeight - 200));
    const maxW = Math.max(1, this.owner.innerWidth - margin * 2);
    const maxH = Math.max(38, this.owner.innerHeight - top - margin);
    const g = this.geometry;
    g.width = Math.min(maxW, Math.max(Math.min(600, maxW), g.width));
    g.height = Math.min(maxH, Math.max(Math.min(420, maxH), g.height));
    if (this.collapsed) {
      const size = Math.min(this.diameter, maxW, this.owner.innerHeight - margin * 2);
      const c = this.circle;
      c.left = Math.max(margin, Math.min(c.left, this.owner.innerWidth - size - margin));
      c.top = Math.max(Math.min(54, top), Math.min(c.top, this.owner.innerHeight - size - margin));
      this.updateExpandedOrigin();
      Object.assign(this.host.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${size}px`, height: `${size}px` });
      return;
    }
    const width = g.width;
    const height = g.height;
    g.left = Math.max(margin, Math.min(g.left, this.owner.innerWidth - width - margin));
    g.top = Math.max(top, Math.min(g.top, this.owner.innerHeight - height - margin));
    Object.assign(this.host.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${width}px`, height: `${height}px` });
  }
  updateToggle() {
    this.setIcon(this.toggle, this.collapsed ? "plus" : "collapse");
    this.toggle.title = this.collapsed ? "展开 Better Tags · 拖动可移动" : "向右上角收起";
    this.toggle.setAttribute("aria-label", this.collapsed ? "展开 Better Tags 浮窗" : "折叠 Better Tags 浮窗");
    this.toggle.setAttribute("aria-expanded", String(!this.collapsed));
    this.host.classList.toggle("collapsed", this.collapsed);
    // Do not unload the document: filters, selections and unsaved input survive.
    this.frame.hidden = this.resizeHandle.hidden = this.collapsed;
  }
  setCollapsed(value) {
    if (this.closed) return;
    value = !!value;
    if (value && !this.collapsed) {
      const button = this.toggle.getBoundingClientRect();
      const box = this.host.getBoundingClientRect();
      const x = button.left + button.width / 2, y = button.top + button.height / 2;
      this.anchor = { right: box.right - x, top: y - box.top };
      this.circle = { left: x - this.diameter / 2, top: y - this.diameter / 2 };
    }
    if (!value && this.collapsed) this.updateExpandedOrigin();
    this.collapsed = !!value;
    this.updateToggle(); this.layout(); this.saveGeometry();
    if (this.collapsed) this.toggle.focus();
    else {
      this.window?.focus();
      this.window?.TagWorkspaceUI?.scheduleRefresh(true);
    }
  }
  focus() {
    this.setCollapsed(false);
    this.window?.focus();
  }
  updateExpandedOrigin() {
    this.geometry.left = this.circle.left + this.diameter / 2 - this.geometry.width + this.anchor.right;
    this.geometry.top = this.circle.top + this.diameter / 2 - this.anchor.top;
  }
  bindDrag(handle, resize, circleOnly = false) {
    let start = null;
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0 || (circleOnly ? !this.collapsed : e.target.closest("button"))) return;
      if (!circleOnly) e.preventDefault();
      this.suppressClick = false;
      start = { x: e.clientX, y: e.clientY, ...this.geometry, circle: this.circle && { ...this.circle }, moved: false };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      this.host.classList.add("dragging");
      if (circleOnly) { this.circle.left = start.circle.left + dx; this.circle.top = start.circle.top + dy; }
      else if (resize) { this.geometry.width = start.width + dx; this.geometry.height = start.height + dy; }
      else { this.geometry.left = start.left + dx; this.geometry.top = start.top + dy; }
      this.layout();
    });
    const finish = () => {
      if (!start) return;
      // Consume only the click generated by this drag, so releasing the circle
      // does not accidentally expand it. A later click starts a new gesture.
      this.suppressClick = circleOnly && start.moved;
      if (this.suppressClick) this.owner.setTimeout(() => { this.suppressClick = false; }, 0);
      start = null; this.host.classList.remove("dragging"); this.saveGeometry();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("pointercancel", finish);
  }
  close(force = false) {
    if (this.closed) return true;
    const ui = this.window?.TagWorkspaceUI;
    if (!force && (ui?.busy || this.service.pending)) {
      ui?.status("正在保存标签，完成后即可关闭浮窗。");
      return false;
    }
    this.saveGeometry();
    ui?.dispose();
    this.owner.removeEventListener("resize", this.onResize);
    this.closed = true;
    this.host.remove(); this.style.remove();
    if (this.service.floating === this) { this.service.floating = null; this.service.panel = null; }
    return true;
  }
};

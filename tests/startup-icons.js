/* Runs only in a disposable Zotero profile; no user library is accessed. */
var started = false, root, result = { passed: false, checks: [], samples: [] };
function install() {} function uninstall() {} function shutdown() {}
function startup() { root = Services.prefs.getStringPref('tagWorkspace.testRoot'); setTimeout(run, 1800); }
function onMainWindowLoad() { setTimeout(run, 1800); }
async function waitFor(fn) {
  const start = Date.now();
  while (!await fn()) {
    if (Date.now() - start > 30000) throw new Error('Timed out: ' + fn);
    await Zotero.Promise.delay(50);
  }
}
function check(ok, message) { if (!ok) throw new Error(message); result.checks.push(message); }
async function run() {
  if (started) return; started = true;
  let observer;
  try {
    await Zotero.initializationPromise;
    await waitFor(() => Zotero.getMainWindow()?.ZoteroPane?.itemsView);
    if (Zotero.DataDirectory.dir !== PathUtils.join(root, 'data') || !root.includes('\\test-runs\\run-')) throw new Error('Isolation failed');
    const win = Zotero.getMainWindow(), doc = win.document;
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const addon = await AddonManager.getAddonByID('tag-workspace@local.tools');
    result.version = addon.version; result.application = Zotero.version;
    const controller = () => doc.getElementById('better-tags-panel')?.betterTagsController;
    await waitFor(controller); await controller().ready;
    const sample = phase => {
      const icons = [...doc.querySelectorAll('#better-tags-panel header img, #better-tags-show img, #tag-workspace-button > .toolbarbutton-icon')];
      check(icons.length === 3, phase + ': all three icons present');
      for (const icon of icons) {
        const rect = icon.getBoundingClientRect();
        const size = icon.classList.contains('toolbarbutton-icon') ? 24 : 20;
        result.samples.push({ phase, node: icon.parentNode.id || 'header', width: rect.width, height: rect.height });
        check(rect.width > 0 && rect.width <= size && rect.height > 0 && rect.height <= size, phase + ': icon bounded to ' + size + 'px');
      }
    };
    sample('cold startup');
    const blockStyles = () => {
      for (const link of doc.querySelectorAll('link[href*="tag-workspace/content/"]')) link.media = 'not all';
    };
    // Reproduce arbitrarily late external CSS, including after image decoding.
    blockStyles(); await Zotero.Promise.delay(100); sample('external CSS unavailable');
    await addon.disable();
    check(!doc.getElementById('better-tags-toolbar-style') && !doc.getElementById('tag-workspace-button'), 'Disable removes icon and synchronous stylesheet');
    observer = new win.MutationObserver(blockStyles);
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    await addon.enable(); await waitFor(controller); await controller().ready;
    await waitFor(() => [...doc.querySelectorAll('#better-tags-panel img, #better-tags-show img')].every(img => img.complete && img.naturalWidth > 0));
    for (let i = 0; i < 5; i++) { sample('CSS withheld frame ' + i); await Zotero.Promise.delay(30); }
    observer.disconnect(); observer = null;
    for (const link of doc.querySelectorAll('link[href*="tag-workspace/content/"]')) link.media = '';
    await Zotero.Promise.delay(200); sample('stylesheet restored');
    check(doc.querySelectorAll('#better-tags-toolbar-style').length === 1, 'Re-enable has exactly one toolbar stylesheet');
    const button = doc.getElementById('tag-workspace-button');
    const neighbor = doc.createXULElement('toolbarbutton'); neighbor.className = 'zotero-tb-button';
    button.after(neighbor);
    check(button.getBoundingClientRect().right <= neighbor.getBoundingClientRect().left, 'Toolbar keeps neighboring plugin buttons separate');
    neighbor.remove();
    const ctl = controller(); ctl.setVisible(false); ctl.$('show').click();
    check(ctl.visible, 'Compact icon still reopens the panel');
    result.passed = true;
  } catch (error) { result.error = String(error); result.stack = error.stack; Zotero.logError(error); }
  finally { observer?.disconnect(); }
  await IOUtils.writeJSON(PathUtils.join(root, 'startup-icons-results.json'), result);
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}

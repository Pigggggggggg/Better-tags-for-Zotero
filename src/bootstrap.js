"use strict";
var chromeHandle;
var TagWorkspaceCore;
var TagWorkspaceService;
var TagWorkspaceEmbedded;
var TagWorkspaceTitles;
var service;

async function startup({ rootURI, version }) {
  const registrar = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  chromeHandle = registrar.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "tag-workspace", ""]
  ]);
  Services.scriptloader.loadSubScript(rootURI + "core.js", globalThis);
  Services.scriptloader.loadSubScript(rootURI + "titles.js", globalThis);
  Services.scriptloader.loadSubScript(rootURI + "embedded.js", globalThis);
  Services.scriptloader.loadSubScript(rootURI + "service.js", globalThis);
  service = new TagWorkspaceService(Zotero, TagWorkspaceCore, version);
  for (const win of Zotero.getMainWindows()) service.attach(win);
}

function onMainWindowLoad({ window }) { service?.attach(window); }
function onMainWindowUnload({ window }) { service?.detach(window); }
async function shutdown() {
  await service?.destroy();
  service = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
async function install({ id }) {
  // This is an offline, manually distributed build. .invalid cannot be claimed
  // by a third party. Zotero requires an HTTPS update URL even for local builds.
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const addon = await AddonManager.getAddonByID(id);
  if (addon) addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
}
function uninstall() {}

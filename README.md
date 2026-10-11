<p align="center"><img src="src/icons/better-tags.png" width="80" height="80" alt="Better Tags logo"></p>

# Better-Tags-for-Zotero

[中文说明](README.zh-CN.md) · [Downloads](https://github.com/Pigggggggggg/Better-tags-for-Zotero/releases) · [Report an issue](https://github.com/Pigggggggggg/Better-tags-for-Zotero/issues)

Better Tags replaces Zotero's bottom-left tag selector with a compact tag navigation panel. Organize tags into nested groups and filter your library while keeping Zotero's original item list, search field, and PDF reader.

**Version 1.0.1 · Zotero 10.0.x · Chinese interface · MIT license**

## Features

- Click a tag to replace the current tag selection. Hold **Ctrl or Alt** while clicking to add or remove tags; release the modifier between clicks if needed.
- Combine selected tags with **All** (intersection) or **ANY** (union). Search the results using Zotero's own search field.
- Filter the whole current library by default, or switch to the current collection/search scope.
- Create nested groups, put a tag in multiple groups, and reorder sibling groups by dragging their names. Group headings expand/collapse; the separate filter button selects the group's tags and descendants.
- Browse alphabetically sorted pastel tag chips with item counts. Right-click a tag to rename it or choose a background color from the supplied palette.
- Add/remove tags in bulk, undo the last batch operation where no conflicting edits exist, and save filter combinations.
- Automatically add existing tags to selected items from their **titles only**, using the item context menu. Matching ignores case and recognizes common English singular/plural forms. `battery` does not imply `Flow battery`; `Flow batteries` can match both.
- Keep the sidebar's chosen height proportion when resizing Zotero. Tag-filtered results keep child attachments/notes collapsed by default, and startup icons retain their intended size before external CSS loads.

## Install

1. Download **`better-tags-1.0.1.xpi`** from [Releases](https://github.com/Pigggggggggg/Better-tags-for-Zotero/releases). GitHub's automatic source archives are not installable add-ons.
2. Open Zotero's add-on manager from **Tools → Plugins** (the wording may vary by interface language).
3. Use the gear menu's **Install Add-on From File…** option and choose the XPI.
4. Open the panel using the Better Tags icon in the item toolbar or **Tools → Better Tags…**.

This build targets Zotero **10.0.x**. Runtime verification is performed on Windows; macOS and Linux have not been independently verified. Zotero 7/8/9 are outside the declared compatibility range.

Updates are installed manually from Releases. Automatic update distribution is not configured in this release.

## Data and settings

Item tags are Zotero's native tags and follow Zotero's normal synchronization settings. Better Tags groups, colors, saved combinations, and layout preferences are stored locally in the Zotero profile and do not sync between devices. The plugin needs no API key or local API server.

The add-on ID remains `tag-workspace@local.tools` so existing Better Tags settings can be retained. Version **1.0.1** is the public release numbering reset from the private development build **2.2.2**; it contains that build's final functionality, not the old private 1.x interface. If using a private 2.x build, install this XPI manually without uninstalling the previous add-on.

## Build and test

Use Node.js 22 or newer for tests and Windows PowerShell 5.1 or PowerShell 7 for packaging. There are no npm dependencies to install.

```powershell
npm test
npm run build
npm run package:source
```

Generated files are placed in `dist/`: the XPI, its SHA-256 checksum, and an optional source ZIP. The XPI includes the MIT license. Build outputs and disposable test profiles are ignored by Git.

The native Zotero test runners require a separate test profile and data directory. See [development and testing](docs/DEVELOPMENT.md); do not run them in a personal Zotero profile.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/bootstrap.js`, `src/manifest.json` | Zotero add-on entry point and metadata |
| `src/embedded.js`, `src/embedded.css` | Current embedded sidebar and filter controls |
| `src/service.js`, `src/core.js` | Zotero integration, tags, settings and filtering |
| `src/groups.js`, `src/titles.js` | Group editing and formatted title handling |
| `src/icons/` | Better Tags logo |
| `src/workspace.*`, `src/floating.*` | Retained legacy interface code; not loaded by the current entry point |
| `tests/`, `scripts/` | Unit tests, isolated integration runners and packaging tools |

See [CHANGELOG](CHANGELOG.md) for release notes and [LICENSE](LICENSE) for the MIT license.

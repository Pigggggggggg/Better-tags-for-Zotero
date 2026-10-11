# Development and testing

## Build

The source is plain JavaScript/CSS with no npm dependencies. Tests require Node.js 22+; packaging scripts support Windows PowerShell 5.1 and PowerShell 7.

Run from the repository root:

```powershell
npm test
npm run build
npm run package:source
```

The build validates matching `package.json` and `src/manifest.json` versions. Keep the default version in `src/service.js` consistent as well. Runtime startup passes the manifest's version to the service. The XPI contains `src/` contents at its root plus `LICENSE`; `dist/SHA256.txt` records its SHA-256 checksum.

The source archive includes only repository files, not generated XPI files, personal settings, logs or test profiles. `src/workspace.*` and `src/floating.*` are retained legacy code; the active UI is `src/embedded.*`.

## Native Zotero integration tests

Unit tests cannot establish whether Zotero loads an XPI or whether its native UI works. Use a disposable profile and separate data directory for the native runners. The runners deliberately create test items and change add-on state.

After building, prepare an isolated profile from the repository root:

```powershell
$testRoot = & .\scripts\prepare-integration.ps1 -RunName run-embedded
```

Set `$zoteroExe` to your own installed Zotero executable. Launch only the generated profile:

```powershell
$zoteroExe = 'C:\Program Files\Zotero\zotero.exe'
Start-Process -FilePath $zoteroExe -ArgumentList @('-no-remote', '-profile', ('"' + (Join-Path $testRoot 'profile') + '"'), '-purgecaches') -WindowStyle Hidden
```

Once `ready` appears in `$testRoot`, create an empty `start` file there. The embedded runner writes `integration-results.json`. Check that `passed` is true and inspect any reported error. Create an empty `finish` file to ask that isolated Zotero instance to quit.

For the focused icon test, use a fresh run name:

```powershell
$testRoot = & .\scripts\prepare-integration.ps1 -RunName run-icons -Runner startup-icons.js
```

Launch its profile in the same way. This runner requires no start/finish markers, writes `startup-icons-results.json`, and quits the isolated instance automatically. It checks decoded icon bounds with the external plugin stylesheet withheld, re-enabling cleanup, and neighboring toolbar buttons.

Do not copy the test add-on into a personal profile. Never point these runners at an existing Zotero data directory. Existing run directories are not intended for reuse.

## Release conventions

Release 1.0.1 verification: 40 Node unit tests passed and 118 native integration assertions passed on Windows with Zotero 10.0.6 in an isolated profile. The native run installed 1.0.1 over private 2.2.2, checked retained group/preset settings, filters, native search, resizing, tag editing, title matching, and disable/re-enable cleanup. XPI entries were compared with the source files and license; the source ZIP was checked for required files and exclusion of test profiles. These checks do not establish long-term crash freedom or compatibility on other operating systems.

- Add-on ID: `tag-workspace@local.tools`; preserve it and the preference keys for existing users.
- Public release numbering begins at 1.0.1, repackaged from private build 2.2.2. This is an intentional numbering reset.
- Automatic updates remain disabled by `install()` in `src/bootstrap.js`. The reserved `.invalid` update URL in the manifest is a non-serving placeholder; do not present this build as supporting automatic updates.
- Future automatic update support needs a real hosted update manifest, a deliberate migration from private 2.x version numbers, and removal of the forced manual-update preference. It is not part of this release.
- Do not claim that a successful short test proves absence of all crashes or cross-platform compatibility.

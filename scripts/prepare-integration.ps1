param([string]$RunName = ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss')), [string]$UpgradeFrom = '', [ValidatePattern('^[a-z-]+\.js$')][string]$Runner = 'embedded-integration.js')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\manifest.json') | ConvertFrom-Json).version
if ($RunName -notmatch '^run-[a-zA-Z0-9-]+$') { throw 'Invalid test run name' }
$testRoot = Join-Path $projectRoot "test-runs\$RunName"
$profileDir = Join-Path $testRoot 'profile'
$dataDir = Join-Path $testRoot 'data'
$extensionDir = Join-Path $profileDir 'extensions'
$runnerDir = Join-Path $testRoot 'runner'
New-Item -ItemType Directory -Force -Path $extensionDir,$dataDir,$runnerDir | Out-Null
$manifest = '{"manifest_version":2,"name":"Tag Workspace integration tests","version":"1.0.0","applications":{"zotero":{"id":"tag-workspace-tests@local.tools","update_url":"https://tag-workspace.invalid/tests.json","strict_min_version":"10.0","strict_max_version":"10.0.*"}}}'
[IO.File]::WriteAllText((Join-Path $runnerDir 'manifest.json'), $manifest, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $projectRoot "tests\$Runner") -Destination (Join-Path $runnerDir 'bootstrap.js')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($runnerDir, (Join-Path $extensionDir 'tag-workspace-tests@local.tools.xpi'))
$productXPI = if ($UpgradeFrom) { Join-Path $projectRoot $UpgradeFrom } else { Join-Path $projectRoot "dist\better-tags-$version.xpi" }
Copy-Item -LiteralPath $productXPI -Destination (Join-Path $extensionDir 'tag-workspace@local.tools.xpi')
$prefs = [ordered]@{
  'extensions.zotero.dataDir' = $dataDir
  'extensions.zotero.useDataDir' = $true
  'extensions.zotero.firstRun2' = $false
  'extensions.zotero.firstRunGuidance' = $false
  'extensions.zotero.automaticScraperUpdates' = $false
  'extensions.zotero.sync.autoSync' = $false
  'extensions.zotero.httpServer.enabled' = $false
  'extensions.zoteroWinWordIntegration.skipInstallation' = $true
  'extensions.zoteroOpenOfficeIntegration.skipInstallation' = $true
  'extensions.autoDisableScopes' = 0
  'extensions.enabledScopes' = 15
  'app.update.auto' = $false
  'tagWorkspace.testRoot' = $testRoot
  'tagWorkspace.testVersion' = $version
}
$lines = foreach ($entry in $prefs.GetEnumerator()) { 'user_pref(' + (ConvertTo-Json -Compress $entry.Key) + ', ' + (ConvertTo-Json -Compress $entry.Value) + ');' }
[IO.File]::WriteAllText((Join-Path $profileDir 'user.js'), ($lines -join "`n"), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $projectRoot 'test-runs\latest.txt'), $testRoot, [Text.UTF8Encoding]::new($false))
Write-Output $testRoot

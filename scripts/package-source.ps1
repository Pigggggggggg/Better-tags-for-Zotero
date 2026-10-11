$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\manifest.json') | ConvertFrom-Json).version
$outputDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputPath = Join-Path $outputDir "better-tags-$version-source.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($outputPath, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  $files = @()
  foreach ($dir in @('src','scripts','tests','docs')) {
    $files += Get-ChildItem -LiteralPath (Join-Path $projectRoot $dir) -Recurse -File
  }
  $files += Get-ChildItem -LiteralPath $projectRoot -Force -File | Where-Object {
    $_.Extension -in @('.md','.json') -or $_.Name -in @('LICENSE','.gitignore','.gitattributes')
  }
  foreach ($file in $files | Sort-Object FullName) {
    $relativeName = 'Better-tags-for-Zotero/' + $file.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relativeName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Output $outputPath

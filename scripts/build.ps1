$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $projectRoot 'src'
$manifest = Get-Content -LiteralPath (Join-Path $sourceDir 'manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'manifest.json and package.json versions must match.' }
$license = Join-Path $projectRoot 'LICENSE'
if (!(Test-Path -LiteralPath $license)) { throw 'Missing LICENSE' }
$outputDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputFile = Join-Path $outputDir "better-tags-$($manifest.version).xpi"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($outputFile, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $license, 'LICENSE', [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    foreach ($file in Get-ChildItem -LiteralPath $sourceDir -File -Recurse | Sort-Object FullName) {
        $relativeName = $file.FullName.Substring($sourceDir.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relativeName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally { $archive.Dispose(); $stream.Dispose() }
$hash = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $outputDir 'SHA256.txt'), "$hash  $([IO.Path]::GetFileName($outputFile))`n", [Text.UTF8Encoding]::new($false))
Write-Output "Built: $outputFile"
Write-Output "SHA256: $hash"

param([string]$ExecutablePath)
$ErrorActionPreference='Stop'
$mugRoot=Split-Path -Parent $PSScriptRoot
if (-not $ExecutablePath) { $ExecutablePath=Join-Path $mugRoot 'src-tauri/target/release/mugdown.exe' }
$mugVersion=(Get-Content -LiteralPath (Join-Path $mugRoot 'package.json') -Raw | ConvertFrom-Json).version
$mugRelease=Join-Path $mugRoot ('release/v'+$mugVersion)
$mugPortable=Join-Path $mugRelease 'mugdown'
New-Item -ItemType Directory -Path $mugPortable -Force | Out-Null
if ((Get-Item -LiteralPath $ExecutablePath).VersionInfo.ProductVersion -ne $mugVersion) { throw 'Executable version does not match package.json' }
Copy-Item -LiteralPath $ExecutablePath -Destination (Join-Path $mugPortable 'mugdown.exe') -Force
$mugLicenses=Join-Path $mugPortable 'licenses'
New-Item -ItemType Directory -Path $mugLicenses -Force | Out-Null
Copy-Item -Path (Join-Path $mugRoot 'assets/licenses/*') -Destination $mugLicenses -Recurse -Force
Copy-Item -LiteralPath (Join-Path $mugRoot 'docs/portable-readme.txt') -Destination (Join-Path $mugPortable '使用说明.txt') -Force
$mugPresets=Join-Path $mugPortable 'presets'
New-Item -ItemType Directory -Path $mugPresets -Force | Out-Null
$mugDefaultPresets=@(Get-ChildItem -LiteralPath (Join-Path $mugRoot 'assets/presets') -File -Filter '*.css')
foreach ($mugPreset in $mugDefaultPresets) {
  $mugPresetTarget=Join-Path $mugPresets $mugPreset.Name
  if (-not (Test-Path -LiteralPath $mugPresetTarget)) { Copy-Item -LiteralPath $mugPreset.FullName -Destination $mugPresetTarget }
}
$mugZip=Join-Path $mugRelease ('mugdown-'+$mugVersion+'-windows-x64.zip')
# Select distribution files explicitly: a locally launched portable folder may
# already contain personal settings.json, which must never enter the archive.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$mugStagingZip=Join-Path $mugRelease ('package-'+[guid]::NewGuid().ToString('N')+'.zip')
$mugArchive=[IO.Compression.ZipFile]::Open($mugStagingZip,[IO.Compression.ZipArchiveMode]::Create)
try {
  $mugPackageFiles=@((Get-Item -LiteralPath (Join-Path $mugPortable 'mugdown.exe')),(Get-Item -LiteralPath (Join-Path $mugPortable '使用说明.txt')))
  $mugPackageFiles+=@(Get-ChildItem -LiteralPath $mugLicenses -File -Recurse -Filter '*.txt')
  foreach ($mugFile in $mugPackageFiles) {
    $mugEntry='mugdown/'+$mugFile.FullName.Substring($mugPortable.Length+1).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($mugArchive,$mugFile.FullName,$mugEntry,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  # Use the source defaults, not personal changes/additions in the portable folder.
  foreach ($mugPreset in $mugDefaultPresets) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($mugArchive,$mugPreset.FullName,('mugdown/presets/'+$mugPreset.Name),[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $mugArchive.Dispose() }
Move-Item -LiteralPath $mugStagingZip -Destination $mugZip -Force
$mugHash=(Get-FileHash -LiteralPath $mugZip -Algorithm SHA256).Hash.ToLower()
Set-Content -LiteralPath ($mugZip+'.sha256') -Value ($mugHash+'  '+[IO.Path]::GetFileName($mugZip)) -Encoding ascii
Get-Item -LiteralPath $mugZip,(Join-Path $mugPortable 'mugdown.exe') | Select-Object FullName,Length

param([Parameter(Mandatory=$true)][string]$ExecutablePath)
$ErrorActionPreference='Stop'
$mugCheckRoot=Split-Path -Parent $PSScriptRoot
$mugCheckExe=(Get-Item -LiteralPath $ExecutablePath).FullName
$mugCheckVersion=(Get-Item -LiteralPath $mugCheckExe).VersionInfo.ProductVersion
$mugCheckFixture=Join-Path $mugCheckRoot ('.qa/package-settings/'+[guid]::NewGuid().ToString('N'))
foreach ($mugCheckFolder in @('scripts','assets/licenses','assets/presets','docs',('release/v'+$mugCheckVersion+'/mugdown/presets'))) {
  New-Item -ItemType Directory -Path (Join-Path $mugCheckFixture $mugCheckFolder) -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package-portable.ps1') -Destination (Join-Path $mugCheckFixture 'scripts/package-portable.ps1')
@{version=$mugCheckVersion} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $mugCheckFixture 'package.json') -Encoding utf8
Set-Content -LiteralPath (Join-Path $mugCheckFixture 'assets/licenses/fixture.txt') -Value 'Fixture license'
Set-Content -LiteralPath (Join-Path $mugCheckFixture 'assets/presets/Air.css') -Value 'p { color: blue; }'
Set-Content -LiteralPath (Join-Path $mugCheckFixture 'docs/portable-readme.txt') -Value 'Fixture readme'
$mugCheckSettings=Join-Path $mugCheckFixture ('release/v'+$mugCheckVersion+'/mugdown/settings.json')
$mugCheckContents='{"language":"en-US","customCss":"personal preference"}'
Set-Content -LiteralPath $mugCheckSettings -Value $mugCheckContents -Encoding utf8
$mugCheckBefore=(Get-FileHash -LiteralPath $mugCheckSettings).Hash
$mugCheckPersonalPreset=Join-Path $mugCheckFixture ('release/v'+$mugCheckVersion+'/mugdown/presets/Air.css')
Set-Content -LiteralPath $mugCheckPersonalPreset -Value 'p { color: red; }'
$mugCheckPresetBefore=(Get-FileHash -LiteralPath $mugCheckPersonalPreset).Hash
Set-Content -LiteralPath (Join-Path (Split-Path -Parent $mugCheckPersonalPreset) 'Personal.css') -Value 'p { color: green; }'
& (Join-Path $mugCheckFixture 'scripts/package-portable.ps1') -ExecutablePath $mugCheckExe | Out-Null
$mugCheckZip=Join-Path $mugCheckFixture ('release/v'+$mugCheckVersion+'/mugdown-'+$mugCheckVersion+'-windows-x64.zip')
$mugCheckArchive=[IO.Compression.ZipFile]::OpenRead($mugCheckZip)
try {
  $mugCheckNames=@($mugCheckArchive.Entries | ForEach-Object { $_.FullName })
  if (@($mugCheckNames | Where-Object { $_ -match 'settings\.json' }).Count -ne 0) { throw 'Personal settings included in package' }
  if ($mugCheckNames.Count -ne 4 -or -not ($mugCheckNames -contains 'mugdown/mugdown.exe')) { throw 'Missing distribution files or personal preset included' }
  if ((Get-FileHash -LiteralPath $mugCheckSettings).Hash -ne $mugCheckBefore) { throw 'Packaging changed personal settings' }
  if ((Get-FileHash -LiteralPath $mugCheckPersonalPreset).Hash -ne $mugCheckPresetBefore) { throw 'Packaging changed personal preset' }
  $mugCheckReader=[IO.StreamReader]::new($mugCheckArchive.GetEntry('mugdown/presets/Air.css').Open())
  try { if (-not $mugCheckReader.ReadToEnd().Contains('blue')) { throw 'Personal preset changes included in archive' } } finally { $mugCheckReader.Dispose() }
  $mugCheckResult=[pscustomobject]@{PersonalSettingsExcluded=$true;PersonalSettingsPreserved=$true;DistributionFilesPresent=$true;PersonalPresetsExcluded=$true;PersonalPresetsPreserved=$true}
  $mugCheckResult | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $mugCheckRoot '.qa/package-settings-checks.json') -Encoding utf8
  $mugCheckResult | ConvertTo-Json
} finally { $mugCheckArchive.Dispose() }

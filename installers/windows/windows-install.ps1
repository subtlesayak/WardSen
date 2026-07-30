param(
  [switch]$Start,
  [switch]$ProvidersOnly,
  [switch]$DownloadBitwardenCli,
  [switch]$PackageDesktop
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$providerBin = Join-Path $root ".wardsen-providers\bin"

function Require-Command($Name, $WingetId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "$Name is required and winget is not available."
  }
  winget install --id $WingetId --source winget --accept-package-agreements --accept-source-agreements
}

function Require-NodeVersion {
  Require-Command "node" "OpenJS.NodeJS.LTS"
  $versionText = (& node -p "process.versions.node").Trim()
  $parts = $versionText.Split(".") | ForEach-Object { [int]$_ }
  $major = $parts[0]
  $minor = $parts[1]
  if (($major -eq 20 -and $minor -ge 19) -or ($major -ge 22)) {
    return
  }
  throw "WardSen's current packages require Node.js 20.19.0 or newer, or Node.js 22.12.0 or newer. Detected Node.js $versionText. Update Node.js LTS and rerun this installer."
}

function Get-GitHubJson($Uri) {
  Invoke-RestMethod -Headers @{ "User-Agent" = "WardSen installer" } -Uri $Uri
}

function Get-BitwardenWindowsAsset {
  $release = Get-GitHubJson "https://api.github.com/repos/bitwarden/clients/releases/latest"
  $asset = $release.assets |
    Where-Object {
      $_.name -match '(?i)bw-windows.*\.zip$' -and
      $_.name -notmatch '(?i)(arm64|oss|source)'
    } |
    Select-Object -First 1
  if (-not $asset) {
    throw "Could not find a current Windows x64 Bitwarden CLI archive."
  }
  [PSCustomObject]@{ Release = $release; Asset = $asset }
}

function Find-Sha256InText($Text, $FileName) {
  $escaped = [regex]::Escape($FileName)
  $patterns = @(
    "([a-fA-F0-9]{64})\s+[*]?$escaped",
    "$escaped\s+([a-fA-F0-9]{64})",
    "sha256[:=]\s*([a-fA-F0-9]{64})"
  )
  foreach ($pattern in $patterns) {
    $match = [regex]::Match($Text, $pattern)
    if ($match.Success) { return $match.Groups[1].Value.ToLowerInvariant() }
  }
  return $null
}

function Get-BitwardenAssetSha256($Release, $Asset) {
  $releaseBody = ""
  if ($Release.body) { $releaseBody = [string]$Release.body }
  $bodyHash = Find-Sha256InText $releaseBody $Asset.name
  if ($bodyHash) { return $bodyHash }

  $checksumAsset = $Release.assets |
    Where-Object { $_.name -match '(?i)(sha256|checksums?).*\.(txt|sha256|sum)$' } |
    Select-Object -First 1
  if (-not $checksumAsset) { return $null }

  $checksumText = Invoke-RestMethod -Headers @{ "User-Agent" = "WardSen installer" } -Uri $checksumAsset.browser_download_url
  return Find-Sha256InText $checksumText $Asset.name
}

function Install-BitwardenCliFromRelease {
  New-Item -ItemType Directory -Force -Path $providerBin | Out-Null
  $selection = Get-BitwardenWindowsAsset
  $expectedHash = Get-BitwardenAssetSha256 $selection.Release $selection.Asset
  if (-not $expectedHash) {
    throw "Refusing to install Bitwarden CLI because SHA-256 integrity data could not be verified."
  }

  $archive = Join-Path $env:TEMP $selection.Asset.name
  Invoke-WebRequest -Headers @{ "User-Agent" = "WardSen installer" } -Uri $selection.Asset.browser_download_url -OutFile $archive
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Bitwarden CLI SHA-256 mismatch. Expected $expectedHash but got $actualHash."
  }

  Expand-Archive -LiteralPath $archive -DestinationPath $providerBin -Force
  $env:PATH = "$providerBin;$env:PATH"
}

function Start-WardSen {
  Push-Location $root
  try {
    npm install
    npm run dev
  } finally {
    Pop-Location
  }
}

function Build-WardSenDesktop {
  Require-Command "rustup" "Rustlang.Rustup"
  Push-Location $root
  try {
    npm ci
    npm run build:server
    npm run build:web
    npm run desktop:build
  } finally {
    Pop-Location
  }
}

Require-NodeVersion
if ($DownloadBitwardenCli) {
  Install-BitwardenCliFromRelease
} else {
  Require-Command "bw" "Bitwarden.CLI"
}

New-Item -ItemType Directory -Force -Path (Join-Path $env:APPDATA "Bitwarden CLI") | Out-Null
bw --version | Out-Host

Write-Host "WardSen provider prerequisites checked."
if ($ProvidersOnly) { return }
if ($PackageDesktop) {
  Build-WardSenDesktop
  return
}
if ($Start) { Start-WardSen }

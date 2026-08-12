param(
  [string]$BundleRoot = ".\apps\desktop\src-tauri\target\release\bundle",
  [string]$PublisherName,
  [string]$PfxPath,
  [string]$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

function Find-SignTool {
  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $kitRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitRoot) {
    $candidate = Get-ChildItem -Path $kitRoot -Recurse -Filter "signtool.exe" |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  throw "signtool.exe was not found. Install the Windows SDK, then rerun this script."
}

function Get-ReleaseArtifacts($Root) {
  if (-not (Test-Path -LiteralPath $Root)) {
    throw "Bundle root does not exist: $Root"
  }
  $files = Get-ChildItem -LiteralPath $Root -Recurse -File |
    Where-Object { $_.Extension -in ".exe", ".msi" } |
    Sort-Object FullName
  if (-not $files) {
    throw "No Windows installer artifacts found under $Root"
  }
  return $files
}

function Invoke-SignTool($Arguments) {
  & $signtool @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed with exit code $LASTEXITCODE."
  }
}

$resolvedBundleRoot = (Resolve-Path -LiteralPath $BundleRoot).Path
$signtool = Find-SignTool
$artifacts = Get-ReleaseArtifacts $resolvedBundleRoot

if (-not $VerifyOnly) {
  if (-not $TimestampUrl) {
    throw "Set -TimestampUrl or WINDOWS_TIMESTAMP_URL before signing."
  }

  foreach ($artifact in $artifacts) {
    $args = @("sign", "/fd", "SHA256", "/tr", $TimestampUrl, "/td", "SHA256")
    if ($PfxPath) {
      if (-not (Test-Path -LiteralPath $PfxPath)) { throw "PFX file not found: $PfxPath" }
      if (-not $env:WINDOWS_CERTIFICATE_PASSWORD) { throw "Set WINDOWS_CERTIFICATE_PASSWORD before signing with a PFX file." }
      $args += @("/f", (Resolve-Path -LiteralPath $PfxPath).Path, "/p", $env:WINDOWS_CERTIFICATE_PASSWORD)
    } elseif ($PublisherName) {
      $args += @("/n", $PublisherName)
    } else {
      throw "Provide either -PublisherName for a certificate-store cert or -PfxPath for a PFX file."
    }
    $args += $artifact.FullName
    Invoke-SignTool $args
  }
}

foreach ($artifact in $artifacts) {
  Invoke-SignTool @("verify", "/pa", "/v", $artifact.FullName)
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$previousBundleRoot = $env:WARDSEN_BUNDLE_ROOT
$previousPlatform = $env:WARDSEN_SIGNING_PLATFORM
$previousMethod = $env:WARDSEN_SIGNING_METHOD
$previousVerifier = $env:WARDSEN_SIGNING_VERIFIER
try {
  $env:WARDSEN_BUNDLE_ROOT = $resolvedBundleRoot
  if (-not $env:WARDSEN_SIGNING_PLATFORM) { $env:WARDSEN_SIGNING_PLATFORM = "windows-x64" }
  if (-not $env:WARDSEN_SIGNING_METHOD) { $env:WARDSEN_SIGNING_METHOD = "authenticode" }
  if (-not $env:WARDSEN_SIGNING_VERIFIER) { $env:WARDSEN_SIGNING_VERIFIER = "signtool verify /pa /v" }
  & node (Join-Path $repoRoot "scripts\write-signing-evidence.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "Could not write Windows signing evidence."
  }
} finally {
  $env:WARDSEN_BUNDLE_ROOT = $previousBundleRoot
  $env:WARDSEN_SIGNING_PLATFORM = $previousPlatform
  $env:WARDSEN_SIGNING_METHOD = $previousMethod
  $env:WARDSEN_SIGNING_VERIFIER = $previousVerifier
}

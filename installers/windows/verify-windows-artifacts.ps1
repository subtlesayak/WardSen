param(
  [string]$BundleRoot = ".\apps\desktop\src-tauri\target\release\bundle"
)

$ErrorActionPreference = "Stop"

$signScript = Join-Path $PSScriptRoot "sign-windows-artifacts.ps1"
& $signScript -BundleRoot $BundleRoot -VerifyOnly

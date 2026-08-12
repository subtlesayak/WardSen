param(
  [Parameter(Mandatory = $true)]
  [string]$PreviousInstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$EvidenceBundleRoot,
  [switch]$AllowSystemChanges,
  [switch]$Interactive,
  [switch]$ConfirmVaultAccountsPreserved
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { throw "This lifecycle test must run on Windows." }
if (-not $AllowSystemChanges) { throw "Refusing to install or uninstall without -AllowSystemChanges on a disposable Windows test machine." }
if (-not $Interactive) { throw "Use -Interactive so an operator can verify the vault-account upgrade checkpoint." }
if (-not $ConfirmVaultAccountsPreserved) { throw "Use -ConfirmVaultAccountsPreserved only after verifying account metadata survives the upgrade." }

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$previousInstaller = Resolve-Path -LiteralPath $PreviousInstallerPath
$installer = Resolve-Path -LiteralPath $InstallerPath
$bundleRoot = Resolve-Path -LiteralPath $EvidenceBundleRoot
if ($previousInstaller.Extension -ne ".msi" -or $installer.Extension -ne ".msi") { throw "Both lifecycle installers must be .msi files." }

$logRoot = Join-Path $env:TEMP ("wardsen-msi-lifecycle-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Msi([string[]]$Arguments, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $rawArguments = $Arguments + @("/qn", "/norestart", "/L*v", $logPath)
  $quotedArguments = $rawArguments | ForEach-Object {
    if ($_ -match "\s") { '"{0}"' -f $_.Replace('"', '\"') } else { $_ }
  }
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $quotedArguments -Wait -PassThru -NoNewWindow
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "msiexec failed with exit code $($process.ExitCode). Log: $logPath"
  }
}

function Find-WardSenExecutable {
  $candidates = @(
    (Join-Path $env:ProgramFiles "WardSen\WardSen.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "WardSen\WardSen.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\WardSen\WardSen.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return $candidates | Select-Object -First 1
}

try {
  Invoke-Msi @("/i", $previousInstaller.Path) "previous-install.log"
  $previousExecutable = Find-WardSenExecutable
  if (-not $previousExecutable) { throw "WardSen executable was not found after previous-version install." }
  Start-Process -FilePath $previousExecutable
  Read-Host "Create a harmless test vault account in the previous WardSen version, close WardSen, then press Enter" | Out-Null

  Invoke-Msi @("/i", $installer.Path) "upgrade-install.log"
  $currentExecutable = Find-WardSenExecutable
  if (-not $currentExecutable) { throw "WardSen executable was not found after upgrade install." }
  Start-Process -FilePath $currentExecutable
  Read-Host "Verify the same test vault account is present after upgrade, close WardSen, then press Enter" | Out-Null

  Invoke-Msi @("/x", $installer.Path) "uninstall.log"
  if (Find-WardSenExecutable) { throw "WardSen executable remains after uninstall." }

  $env:WARDSEN_BUNDLE_ROOT = $bundleRoot.Path
  $env:WARDSEN_INSTALL_LIFECYCLE_PLATFORM = "windows-x64"
  $env:WARDSEN_INSTALL_LIFECYCLE_ARTIFACT = $installer.Path
  $env:WARDSEN_INSTALL_LIFECYCLE_TEST_ENV = "disposable Windows machine"
  $env:WARDSEN_INSTALL_LIFECYCLE_STEPS = "fresh_install,launch,upgrade,vault_metadata_preserved,uninstall"
  node (Join-Path $root "scripts\write-install-lifecycle-evidence.mjs")
} finally {
  Remove-Item -LiteralPath $logRoot -Recurse -Force -ErrorAction SilentlyContinue
}

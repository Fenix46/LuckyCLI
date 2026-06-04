<#
.SYNOPSIS
  LuckyCLI installer for Windows.

.DESCRIPTION
  Downloads the prebuilt `lucky` binary for Windows from the latest GitHub
  release, verifies its SHA-256 checksum, installs it into
  %LOCALAPPDATA%\Programs\LuckyCLI, and adds that folder to your user PATH.

  Install the latest release:
    irm https://raw.githubusercontent.com/Fenix46/LuckyCLI/main/install.ps1 | iex

  Pin a version or change the install dir with environment variables:
    $env:LUCKY_VERSION = "v0.2.1"
    $env:LUCKY_INSTALL_DIR = "C:\tools\lucky"
    irm https://raw.githubusercontent.com/Fenix46/LuckyCLI/main/install.ps1 | iex
#>

# `irm ... | iex` runs this without -File, so set strictness explicitly.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Repo     = "Fenix46/LuckyCLI"
$BinName  = "lucky"
$Version  = if ($env:LUCKY_VERSION) { $env:LUCKY_VERSION } else { "latest" }
$InstallDir = if ($env:LUCKY_INSTALL_DIR) {
    $env:LUCKY_INSTALL_DIR
} else {
    Join-Path $env:LOCALAPPDATA "Programs\LuckyCLI"
}

# --- pretty output -----------------------------------------------------------
function Write-Info { param([string]$Msg) Write-Host "› $Msg" -ForegroundColor DarkGray }
function Write-Ok   { param([string]$Msg) Write-Host "✓ $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "! $Msg" -ForegroundColor Yellow }
function Die        { param([string]$Msg) Write-Host "✗ $Msg" -ForegroundColor Red; exit 1 }

# --- detect platform ---------------------------------------------------------
# Bun only cross-compiles a Windows x64 target, so that's the single asset.
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq "ARM64") {
    Write-Warn "Windows on ARM detected; installing the x64 build (runs under emulation)."
}
$asset = "$BinName-windows-x64.exe"

if ($Version -eq "latest") {
    $baseUrl = "https://github.com/$Repo/releases/latest/download"
} else {
    $baseUrl = "https://github.com/$Repo/releases/download/$Version"
}
$assetUrl     = "$baseUrl/$asset"
$checksumsUrl = "$baseUrl/SHA256SUMS"

Write-Host "Installing LuckyCLI ($asset, $Version)" -ForegroundColor White

# Modern TLS for older PowerShell hosts that still default to TLS 1.0/1.1.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# --- download ----------------------------------------------------------------
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lucky-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$tmpBin = Join-Path $tmpDir $asset

try {
    Write-Info "Downloading from $assetUrl"
    try {
        Invoke-WebRequest -Uri $assetUrl -OutFile $tmpBin -UseBasicParsing
    } catch {
        Die "Download failed. Does a release with asset '$asset' exist? See https://github.com/$Repo/releases"
    }
    if (-not (Test-Path $tmpBin) -or (Get-Item $tmpBin).Length -eq 0) {
        Die "Downloaded file is empty."
    }

    # --- verify checksum -----------------------------------------------------
    # SHA256SUMS lines look like:  <hex>  lucky-windows-x64.exe
    Write-Info "Verifying checksum"
    $expected = $null
    try {
        $sums = (Invoke-WebRequest -Uri $checksumsUrl -UseBasicParsing).Content
        foreach ($line in ($sums -split "`n")) {
            $parts = ($line.Trim() -split "\s+", 2)
            if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) {
                $expected = $parts[0].Trim().ToLower()
                break
            }
        }
    } catch {
        Write-Warn "Could not fetch SHA256SUMS; skipping checksum verification."
    }
    if ($expected) {
        $actual = (Get-FileHash -Path $tmpBin -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) {
            Die "Checksum mismatch for $asset.`n  expected $expected`n  got      $actual"
        }
        Write-Ok "Checksum verified"
    }

    # --- install -------------------------------------------------------------
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $target = Join-Path $InstallDir "$BinName.exe"
    Copy-Item -Path $tmpBin -Destination $target -Force
    Write-Ok "Installed to $target"
} finally {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- PATH --------------------------------------------------------------------
# Persist on the *user* PATH (no admin needed) and update this session too.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$onPath = $false
if ($userPath) {
    foreach ($p in ($userPath -split ";")) {
        if ($p.Trim().TrimEnd("\") -ieq $InstallDir.TrimEnd("\")) { $onPath = $true; break }
    }
}

if ($onPath) {
    Write-Info "$InstallDir is already on your PATH"
} else {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $InstallDir } else { "$userPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$InstallDir"   # available immediately in this session
    Write-Ok "Added $InstallDir to your user PATH"
    Write-Warn "Open a new terminal for the PATH change to apply everywhere."
}

Write-Host ""
Write-Ok "Done. Start it with: $BinName"

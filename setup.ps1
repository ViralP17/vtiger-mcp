# =====================================================================
#  vtiger-mcp — one-time setup for Windows + Claude Desktop
#
#  For non-developers: right-click this file -> "Run with PowerShell"
#  (or in a terminal:  powershell -ExecutionPolicy Bypass -File setup.ps1)
#
#  It installs what's needed, then writes your Claude Desktop config so
#  you can log timesheets just by chatting. You only answer 2 questions:
#  your vtiger username and your Webservice Access Key.
# =====================================================================

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host ""
Write-Host "===== vtiger-mcp setup =====" -ForegroundColor Cyan
Write-Host ""

# --- 1. Node.js check -------------------------------------------------
$nodeVer = $null
try { $nodeVer = (node --version) } catch { }
if (-not $nodeVer) {
  Write-Host "Node.js is not installed." -ForegroundColor Red
  Write-Host "Please install the 'LTS' version from https://nodejs.org/ ," -ForegroundColor Red
  Write-Host "then run this setup again." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
Write-Host "Node.js $nodeVer detected." -ForegroundColor Green

# --- 2. Install + build (one time) -----------------------------------
if (-not (Test-Path "$here\node_modules")) {
  Write-Host "Installing components (one time, ~1 min)..." -ForegroundColor Cyan
  npm install | Out-Host
}
if (-not (Test-Path "$here\dist\mcp\server.js")) {
  Write-Host "Building..." -ForegroundColor Cyan
  npm run build | Out-Host
}
Write-Host "Ready." -ForegroundColor Green
Write-Host ""

# --- 3. Ask for credentials ------------------------------------------
$defaultUrl = "https://yourcrmdomain.com"
$url = Read-Host "Portal URL (press Enter for $defaultUrl)"
if ([string]::IsNullOrWhiteSpace($url)) { $url = $defaultUrl }
$username = Read-Host "Your vtiger username"
$accessKey = Read-Host "Your Webservice Access Key (from My Preferences)"

if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($accessKey)) {
  Write-Host "Username and Access Key are required. Please run setup again." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

# --- 4. Compose the Claude Desktop config ----------------------------
$serverPath = Join-Path $here "dist\mcp\server.js"

# JSON-escape backslashes and quotes for safe embedding.
function Esc([string]$s) { return $s.Replace('\', '\\').Replace('"', '\"') }
$escPath = Esc $serverPath
$escUrl  = Esc $url
$escUser = Esc $username
$escKey  = Esc $accessKey

$json = @"
{
  "mcpServers": {
    "vtiger": {
      "command": "node",
      "args": ["$escPath"],
      "env": {
        "VTIGER_URL": "$escUrl",
        "VTIGER_USERNAME": "$escUser",
        "VTIGER_ACCESS_KEY": "$escKey",
        "VTIGER_ALLOW_DELETE": "false"
      }
    }
  }
}
"@

$cfgDir = Join-Path $env:APPDATA "Claude"
$cfgPath = Join-Path $cfgDir "claude_desktop_config.json"
if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Force $cfgDir | Out-Null }

if (Test-Path $cfgPath) {
  Copy-Item $cfgPath "$cfgPath.backup" -Force
  Write-Host ""
  Write-Host "An existing Claude config was found and backed up to:" -ForegroundColor Yellow
  Write-Host "  $cfgPath.backup" -ForegroundColor Yellow
  Write-Host "If you already use OTHER MCP servers, re-add them from that backup" -ForegroundColor Yellow
  Write-Host "(see SETUP.md -> 'Already using other MCP servers?')." -ForegroundColor Yellow
}

# Write UTF-8 without BOM so Claude Desktop parses it cleanly.
[System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Config written to:" -ForegroundColor Green
Write-Host "  $cfgPath" -ForegroundColor Green
Write-Host ""
Write-Host "LAST STEP: fully quit Claude Desktop (right-click tray icon -> Quit)," -ForegroundColor Cyan
Write-Host "then open it again. Then just type, e.g.:" -ForegroundColor Cyan
Write-Host '   "Log 4 hours to the Website Redesign task today as regular hours"' -ForegroundColor White
Write-Host ""
Read-Host "Done. Press Enter to close"

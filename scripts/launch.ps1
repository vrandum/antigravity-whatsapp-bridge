$ProjectDir = Split-Path -Parent $PSScriptRoot
$CredsFile = Join-Path $ProjectDir "auth_info\creds.json"
$TrayScript = Join-Path $PSScriptRoot "tray.ps1"

# Evita duplicar se o tray.ps1 já estiver rodando
$existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'tray\.ps1' }

if ($existing) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "O Antigravity WhatsApp Bridge já está rodando na bandeja do Windows.",
    "Antigravity WhatsApp Bridge",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  exit 0
}

if (-not (Test-Path $CredsFile)) {
  # Primeira execução: abre terminal visível para escanear o QR Code
  Start-Process "powershell.exe" -ArgumentList "-NoExit", "-Command", "Set-Location '$ProjectDir'; node src/index.mjs"
} else {
  # Já pareado: inicia na bandeja em segundo plano
  Start-Process "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$TrayScript`""
}

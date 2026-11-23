Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\AntigravityWhatsAppBridgeTray", [ref]$createdNew)
if (-not $createdNew) {
  exit 0
}

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectDir "logs"
$EnvFile = Join-Path $ProjectDir ".env"
$CredsFile = Join-Path $ProjectDir "auth_info\creds.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$script:NodeProc = $null

function Start-Bridge {
  Stop-Bridge
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "src/index.mjs"
  $psi.WorkingDirectory = $ProjectDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $script:NodeProc = [System.Diagnostics.Process]::Start($psi)
}

function Stop-Bridge {
  if ($script:NodeProc -and -not $script:NodeProc.HasExited) {
    try {
      $script:NodeProc.Kill($true)
      $script:NodeProc.WaitForExit(3000)
    } catch {}
  }
  $script:NodeProc = $null
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Antigravity WhatsApp Bridge"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemPair = $menu.Items.Add("Parear WhatsApp (abrir terminal QR)")
$itemPair.Add_Click({
  Stop-Bridge
  Start-Process "powershell" -ArgumentList "-NoExit", "-Command", "Set-Location '$ProjectDir'; node src/index.mjs"
})

$itemLogs = $menu.Items.Add("Abrir pasta de logs")
$itemLogs.Add_Click({ Start-Process "explorer.exe" $LogDir })

$itemEnv = $menu.Items.Add("Editar .env")
$itemEnv.Add_Click({ Start-Process "notepad.exe" $EnvFile })

$itemRestart = $menu.Items.Add("Reiniciar ponte")
$itemRestart.Add_Click({
  Start-Bridge
  $notifyIcon.ShowBalloonTip(2000, "Antigravity Bridge", "Ponte reiniciada em segundo plano.", [System.Windows.Forms.ToolTipIcon]::Info)
})

$menu.Items.Add("-") | Out-Null

$itemExit = $menu.Items.Add("Sair")
$itemExit.Add_Click({
  Stop-Bridge
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $menu

if (-not (Test-Path $CredsFile)) {
  $notifyIcon.ShowBalloonTip(4000, "Antigravity Bridge", "WhatsApp ainda não pareado! Clique com o botão direito no ícone e escolha 'Parear WhatsApp'.", [System.Windows.Forms.ToolTipIcon]::Warning)
} else {
  Start-Bridge
}

[System.Windows.Forms.Application]::Run()

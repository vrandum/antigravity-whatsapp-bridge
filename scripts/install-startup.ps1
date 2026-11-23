$ProjectDir = Split-Path -Parent $PSScriptRoot
$TrayScript = Join-Path $PSScriptRoot "tray.ps1"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AntigravityWhatsAppBridge.lnk"

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($ShortcutPath)
$sc.TargetPath = "powershell.exe"
$sc.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TrayScript`""
$sc.WorkingDirectory = $ProjectDir
$sc.Description = "Antigravity WhatsApp Bridge (System Tray)"
$sc.Save()

Write-Output "Atalho criado na inicializacao do Windows: $ShortcutPath"

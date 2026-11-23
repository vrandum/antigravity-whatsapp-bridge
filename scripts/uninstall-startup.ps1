$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AntigravityWhatsAppBridge.lnk"

if (Test-Path $ShortcutPath) {
  Remove-Item $ShortcutPath -Force
  Write-Output "Atalho removido da inicializacao do Windows: $ShortcutPath"
} else {
  Write-Output "Nenhum atalho encontrado em: $ShortcutPath"
}

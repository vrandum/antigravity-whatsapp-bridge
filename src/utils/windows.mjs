import { execFileSync, spawn } from 'node:child_process';

/**
 * Verifica se a sessão do Windows está bloqueada (presença do processo LogonUI.exe).
 */
export function isWindowsLocked() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-Process -Name LogonUI -ErrorAction SilentlyContinue) -ne $null'],
      { encoding: 'utf8', timeout: 3000 }
    );
    return out.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Captura screenshot da tela inteira do Windows via System.Drawing (fallback quando o CDP falha).
 */
export function captureDesktopScreenshot(outputPath) {
  const escaped = outputPath.replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 5000 });
  return outputPath;
}

/**
 * Mantém um processo PowerShell leve chamando SetThreadExecutionState para impedir
 * suspensão e desligamento da tela enquanto a ponte estiver ativa.
 */
export function startPreventSleepGuard() {
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SleepGuard {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$ES_DISPLAY_REQUIRED = [uint32]2
while ($true) {
  [void][SleepGuard]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED)
  Start-Sleep -Seconds 45
}
`;
  const child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return () => {
    try {
      child.kill();
    } catch {}
  };
}

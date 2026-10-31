Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class YNoteDialogs {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

$app = Get-Process -Name y-note -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { exit 0 }

$cancelled = 0
$callback = {
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $class = New-Object System.Text.StringBuilder 256
  [void][YNoteDialogs]::GetClassName($hWnd, $class, $class.Capacity)
  $processId = 0
  [void][YNoteDialogs]::GetWindowThreadProcessId($hWnd, [ref]$processId)
  if (
    [YNoteDialogs]::IsWindowVisible($hWnd) -and
    $class.ToString() -eq '#32770' -and
    $processId -eq $app.Id
  ) {
    [void][YNoteDialogs]::SendMessage($hWnd, 0x0111, [IntPtr]2, [IntPtr]::Zero)
    $script:cancelled += 1
  }
  return $true
}
[void][YNoteDialogs]::EnumWindows($callback, [IntPtr]::Zero)
Write-Output "Cancelled $cancelled dialog(s)"

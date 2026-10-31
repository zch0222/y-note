param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$TimeoutSeconds = 20
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class YNoteDialog {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowTitle);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

$app = Get-Process -Name y-note -ErrorAction SilentlyContinue | Select-Object -First 1
$appProcessId = if ($app) { $app.Id } else { 0 }
$openTitle = [string]([char]0x6253) + [string]([char]0x5F00)

$dialogs = New-Object System.Collections.Generic.List[object]
$callback = {
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $title = New-Object System.Text.StringBuilder 512
  $class = New-Object System.Text.StringBuilder 256
  [void][YNoteDialog]::GetWindowText($hWnd, $title, $title.Capacity)
  [void][YNoteDialog]::GetClassName($hWnd, $class, $class.Capacity)
  $processId = 0
  [void][YNoteDialog]::GetWindowThreadProcessId($hWnd, [ref]$processId)
  if (
    [YNoteDialog]::IsWindowVisible($hWnd) -and
    $class.ToString() -eq '#32770' -and
    ($appProcessId -eq 0 -or $processId -eq $appProcessId) -and
    ($title.ToString().StartsWith($openTitle) -or $title.ToString() -match '^(Open|Select File)')
  ) {
    $dialogs.Add([PSCustomObject]@{ Handle = $hWnd; Title = $title.ToString() })
  }
  return $true
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  $dialogs.Clear()
  [void][YNoteDialog]::EnumWindows($callback, [IntPtr]::Zero)
  if ($dialogs.Count -gt 0) { break }
  Start-Sleep -Milliseconds 200
}
if ($dialogs.Count -eq 0) { throw 'Open dialog not found' }

$dialog = $dialogs[$dialogs.Count - 1].Handle
$combo = [YNoteDialog]::FindWindowEx($dialog, [IntPtr]::Zero, 'ComboBoxEx32', $null)
$edit = [IntPtr]::Zero
if ($combo -ne [IntPtr]::Zero) {
  $inner = [YNoteDialog]::FindWindowEx($combo, [IntPtr]::Zero, 'ComboBox', $null)
  if ($inner -ne [IntPtr]::Zero) {
    $edit = [YNoteDialog]::FindWindowEx($inner, [IntPtr]::Zero, 'Edit', $null)
  }
  if ($edit -eq [IntPtr]::Zero) {
    $edit = [YNoteDialog]::FindWindowEx($combo, [IntPtr]::Zero, 'Edit', $null)
  }
}
if ($edit -eq [IntPtr]::Zero) { throw 'File name edit not found' }

[void][YNoteDialog]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Path)
# IDOK on the standard file dialog accepts the file name without relying on focus or IME.
[void][YNoteDialog]::SendMessage($dialog, 0x0111, [IntPtr]1, [IntPtr]::Zero)

$closeDeadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $closeDeadline) {
  if (-not [YNoteDialog]::IsWindowVisible($dialog)) {
    Write-Output "Selected $Path"
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
throw 'Open dialog did not close'

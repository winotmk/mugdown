param([string]$Action='get',[int]$X=0,[int]$Y=0)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MugdownTestCursor {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  public delegate bool EnumProc(IntPtr window,IntPtr data);
  public static void RestoreProcess(uint id) { EnumWindows((w,d)=>{uint p;GetWindowThreadProcessId(w,out p);if(p==id)ShowWindow(w,9);return true;},IntPtr.Zero); }
}
'@
if ($Action -eq 'set') { [MugdownTestCursor]::SetCursorPos($X,$Y) | Out-Null }
if ($Action -eq 'restore') { [MugdownTestCursor]::RestoreProcess([uint32]$X) }
$mugPoint=New-Object MugdownTestCursor+Point
[MugdownTestCursor]::GetCursorPos([ref]$mugPoint) | Out-Null
@{ x=$mugPoint.X; y=$mugPoint.Y } | ConvertTo-Json -Compress

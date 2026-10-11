Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class CaptureHost {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$h=[IntPtr]::new([long]$env:SMOKE_HOST_HANDLE)
[void][CaptureHost]::SetThreadDpiAwarenessContext([CaptureHost]::GetWindowDpiAwarenessContext($h))
[void][CaptureHost]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300
$r=New-Object CaptureHost+Rect
[void][CaptureHost]::GetWindowRect($h,[ref]$r)
$b=New-Object System.Drawing.Bitmap(($r.Right-$r.Left),($r.Bottom-$r.Top))
$g=[System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size)
$b.Save($env:SMOKE_IMAGE_PATH,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose()

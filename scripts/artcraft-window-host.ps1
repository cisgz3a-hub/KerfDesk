# KerfDesk's own Win32 companion-window host. JSON lines on stdin/stdout only.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

public static class KerfDeskWindowHost {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    public sealed class Entry {
        public IntPtr Window, Parent, OriginalParent;
        public long Style, ExStyle;
        public Rect OriginalRect;
        public bool Visible;
        public int Pid;
        public string Start, Executable;
    }
    public sealed class Info {
        public string window, parent;
        public int pid, x, y, width, height, parentWidth, parentHeight;
        public uint dpi;
        public bool visible;
    }
    private delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetParent(IntPtr window, IntPtr parent);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetLong(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetLong(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    private static Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
    private static int hostPid;
    private static IntPtr host;

    public static void Init(int pid, string handle) {
        hostPid = pid; host = new IntPtr(Int64.Parse(handle)); CheckHost();
    }
    private static void CheckHost() {
        uint actual;
        if (!IsWindow(host) || GetWindowThreadProcessId(host, out actual) == 0 || actual != hostPid)
            throw new Exception("KerfDesk parent window no longer belongs to the host process");
    }
    private static void CheckIdentity(int pid, string start, string executable) {
        using (var process = Process.GetProcessById(pid)) {
            if (process.StartTime.ToUniversalTime().Ticks.ToString() != start ||
                !String.Equals(Path.GetFullPath(process.MainModule.FileName), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase))
                throw new Exception("Editor process identity changed");
        }
    }
    private static Entry Owned(string id) {
        Entry entry;
        if (!entries.TryGetValue(id, out entry)) throw new Exception("Editor is not attached");
        CheckIdentity(entry.Pid, entry.Start, entry.Executable);
        uint pid;
        if (!IsWindow(entry.Window) || GetWindowThreadProcessId(entry.Window, out pid) == 0 || pid != entry.Pid)
            throw new Exception("Editor window no longer belongs to its process");
        return entry;
    }
    private static IntPtr FindWindow(int pid) {
        IntPtr best = IntPtr.Zero; long area = 0;
        EnumWindows(delegate(IntPtr window, IntPtr data) {
            uint owner; Rect rect;
            GetWindowThreadProcessId(window, out owner);
            if (owner != pid || !IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || !GetWindowRect(window, out rect)) return true;
            long size = (long)(rect.Right-rect.Left)*(rect.Bottom-rect.Top);
            if (size > area) { area=size; best=window; }
            return true;
        }, IntPtr.Zero);
        if (best == IntPtr.Zero) throw new Exception("Editor has no visible top-level window yet");
        return best;
    }
    public static void Attach(string id, int pid, string start, string executable) {
        CheckHost(); CheckIdentity(pid, start, executable);
        if (pid == hostPid) throw new Exception("Cannot attach the host process as an editor");
        Entry previousEntry; uint previousPid;
        if(entries.TryGetValue(id,out previousEntry) &&
            (!IsWindow(previousEntry.Window) || GetWindowThreadProcessId(previousEntry.Window,out previousPid)==0 || previousPid!=previousEntry.Pid))
            entries.Remove(id);
        if (entries.ContainsKey(id)) {
            var old = Owned(id);
            if (old.Pid != pid || old.Start != start) throw new Exception("Session already belongs to another editor");
            return;
        }
        IntPtr window = FindWindow(pid);
        foreach (var value in entries.Values) if (value.Window == window) throw new Exception("Editor window is already attached to another session");
        var entry = new Entry { Window=window, Parent=host, OriginalParent=GetParent(window),
            Style=GetLong(window,-16).ToInt64(), ExStyle=GetLong(window,-20).ToInt64(),
            Visible=IsWindowVisible(window), Pid=pid, Start=start, Executable=executable };
        if (!GetWindowRect(window, out entry.OriginalRect)) throw new Exception("Cannot read editor window bounds");
        entries.Add(id, entry);
        try {
            ShowWindow(window,0);
            long style = (entry.Style & 0xffffffffL & ~(0x80000000L|0x00c00000L|0x00040000L|0x00080000L)) | 0x40000000L;
            SetWindowStyle(window,-16,style);
            SetWindowStyle(window,-20,entry.ExStyle & ~0x00040000L);
            SetLastError(0);
            var previous = SetParent(window,host);
            if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0) throw new Exception("SetParent failed: " + Marshal.GetLastWin32Error());
            if (GetParent(window) != host) throw new Exception("Editor parenting was not applied");
        } catch { Detach(id); throw; }
    }
    private static void SetWindowStyle(IntPtr window,int index,long value) {
        SetLastError(0);
        var old=SetLong(window,index,new IntPtr(value));
        if(old==IntPtr.Zero && Marshal.GetLastWin32Error()!=0) throw new Exception("Window style change failed");
    }
    public static Info Layout(string id,double x,double y,double width,double height,double viewportWidth,double viewportHeight) {
        CheckHost(); var entry=Owned(id);
        if (viewportWidth<=0 || viewportHeight<=0 || width<=0 || height<=0 || x<0 || y<0 ||
            x+width>viewportWidth+1 || y+height>viewportHeight+1) throw new Exception("Invalid editor viewport bounds");
        IntPtr oldContext=SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(host));
        try {
            Rect client;
            if(!GetClientRect(host,out client)) throw new Exception("Cannot measure KerfDesk client area");
            double sx=(client.Right-client.Left)/viewportWidth, sy=(client.Bottom-client.Top)/viewportHeight;
            int left=(int)Math.Round(x*sx), top=(int)Math.Round(y*sy);
            int w=Math.Min(client.Right-left,(int)Math.Round(width*sx)), h=Math.Min(client.Bottom-top,(int)Math.Round(height*sy));
            if(w<=0 || h<=0) throw new Exception("Editor viewport is empty");
            foreach(var other in entries.Values) if(other.Window!=entry.Window) ShowWindow(other.Window,0);
            if(!SetWindowPos(entry.Window,IntPtr.Zero,left,top,w,h,0x0010|0x0020|0x0040)) throw new Exception("Editor layout failed");
            return new Info { window=entry.Window.ToInt64().ToString(),parent=GetParent(entry.Window).ToInt64().ToString(),pid=entry.Pid,
                x=left,y=top,width=w,height=h,parentWidth=client.Right,parentHeight=client.Bottom,dpi=GetDpiForWindow(entry.Window),visible=IsWindowVisible(entry.Window) };
        } finally { if(oldContext!=IntPtr.Zero) SetThreadDpiAwarenessContext(oldContext); }
    }
    public static void Hide(string id) { ShowWindow(Owned(id).Window,0); }
    public static void Focus(string id) {
        CheckHost(); var entry=Owned(id);
        uint ignored; uint target=GetWindowThreadProcessId(entry.Window,out ignored);
        uint parentThread=GetWindowThreadProcessId(host,out ignored); uint current=GetCurrentThreadId();
        bool parentAttached=AttachThreadInput(current,parentThread,true);
        bool childAttached=target!=parentThread && AttachThreadInput(current,target,true);
        try { SetForegroundWindow(host); SetFocus(entry.Window); }
        finally {
            if(childAttached) AttachThreadInput(current,target,false);
            if(parentAttached) AttachThreadInput(current,parentThread,false);
        }
    }
    public static void Detach(string id) {
        Entry entry; if(!entries.TryGetValue(id,out entry)) return;
        uint currentPid;
        if(!IsWindow(entry.Window) || GetWindowThreadProcessId(entry.Window,out currentPid)==0 || currentPid!=entry.Pid) {
            entries.Remove(id); return;
        }
        var owned=Owned(id);
        ShowWindow(owned.Window,0);
        IntPtr original=IsWindow(owned.OriginalParent)?owned.OriginalParent:IntPtr.Zero;
        SetLastError(0);
        var previous=SetParent(owned.Window,original);
        if(previous==IntPtr.Zero && Marshal.GetLastWin32Error()!=0) throw new Exception("Cannot detach editor window");
        SetWindowStyle(owned.Window,-16,owned.Style); SetWindowStyle(owned.Window,-20,owned.ExStyle);
        if(GetParent(owned.Window)!=original) throw new Exception("Editor remains attached; keep KerfDesk open");
        var r=owned.OriginalRect;
        if(!SetWindowPos(owned.Window,IntPtr.Zero,r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top,0x0010|0x0020|(owned.Visible?0x0040U:0U)))
            throw new Exception("Cannot restore editor window bounds");
        entries.Remove(id);
    }
    public static void DetachAll() {
        Exception failure=null;
        foreach(var id in new List<string>(entries.Keys)) { try { Detach(id); } catch(Exception error) { failure=error; } }
        if(failure!=null) throw new Exception("Could not safely detach every editor: "+failure.Message);
    }
}
"@
[KerfDeskWindowHost]::Init([int]$env:KERFDESK_WINDOW_HOST_PID,$env:KERFDESK_WINDOW_HOST_HWND)
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $null
        try {
            if ($line.Length -gt 16384) { throw 'Host request is too large' }
            $request = $line | ConvertFrom-Json
            $id = [string]$request.sessionId
            if ($id -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw 'Invalid hosted session' }
            $result = $null
            switch ([string]$request.method) {
                'attach' { [KerfDeskWindowHost]::Attach($id,[int]$request.pid,[string]$request.startTime,[string]$request.executable) }
                'layout' { $r=$request.rect; $result=[KerfDeskWindowHost]::Layout($id,[double]$r.x,[double]$r.y,[double]$r.width,[double]$r.height,[double]$r.viewportWidth,[double]$r.viewportHeight) }
                'hide' { [KerfDeskWindowHost]::Hide($id) }
                'focus' { [KerfDeskWindowHost]::Focus($id) }
                'detach' { [KerfDeskWindowHost]::Detach($id) }
                'dispose' { [KerfDeskWindowHost]::DetachAll() }
                default { throw 'Unknown host request' }
            }
            @{id=$request.id;ok=$true;result=$result} | ConvertTo-Json -Compress -Depth 5 | Write-Output
        } catch {
            @{id=$request.id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress | Write-Output
        }
    }
} finally { [KerfDeskWindowHost]::DetachAll() }

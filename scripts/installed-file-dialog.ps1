param(
  [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'Ownership', 'Inspect', 'Open', 'Save', 'Close')][string]$Action,
  [int]$AppProcessId = 0,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  [string]$FilePath,
  [ValidateRange(1, 60)][int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Native qualification is restricted to disposable GitHub-hosted Windows runners.'
}
$tempRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
$evidencePath = [IO.Path]::GetFullPath($EvidenceRoot)
$allowedRoots = @($tempRoot)
if ($env:GITHUB_WORKSPACE) {
  $allowedRoots += [IO.Path]::GetFullPath((Join-Path $env:GITHUB_WORKSPACE 'artifacts\installed-qualification')).TrimEnd('\') + '\'
}
if (-not @($allowedRoots | Where-Object { $evidencePath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count) {
  throw 'Native dialog evidence must stay inside the owned runner evidence directories.'
}
[IO.Directory]::CreateDirectory($evidencePath) | Out-Null
$result = [ordered]@{ ok = $false; action = $Action; appProcessId = $AppProcessId; startedAt = [DateTime]::UtcNow.ToString('o') }
$exitCode = 0
$rootProcessStartedAt = $null

function Write-JsonFile([string]$Name, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 12
  [IO.File]::WriteAllText((Join-Path $evidencePath $Name), $json, [Text.UTF8Encoding]::new($false))
}

function Assert-OwnedProcess {
  $appProcess = Get-Process -Id $AppProcessId -ErrorAction Stop
  if (-not [string]::Equals($appProcess.Path, [IO.Path]::GetFullPath($ExpectedExecutable), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Native automation PID no longer belongs to the expected installed executable.'
  }
  $started = $appProcess.StartTime.ToUniversalTime()
  if ($null -ne $script:rootProcessStartedAt -and $started -ne $script:rootProcessStartedAt) {
    throw 'Native automation root PID was reused.'
  }
  $script:rootProcessStartedAt = $started
  return $appProcess
}

function Get-EligibleAppProcesses($Processes, [int]$RootProcessId, [string]$Executable, [int]$SessionId, [datetime]$RootStartedAt) {
  if (@($Processes | Group-Object ProcessId | Where-Object Count -GT 1).Count) { throw 'Ambiguous process snapshot.' }
  $matching = @($Processes | Where-Object {
    [string]::Equals($_.ExecutablePath, $Executable, [StringComparison]::OrdinalIgnoreCase) -and
    $_.SessionId -eq $SessionId -and $null -ne $_.CreationDate
  })
  $rootRows = @($matching | Where-Object ProcessId -EQ $RootProcessId)
  if ($rootRows.Count -ne 1 -or [Math]::Abs(($rootRows[0].CreationDate.ToUniversalTime() - $RootStartedAt.ToUniversalTime()).TotalSeconds) -gt 1) {
    throw 'Process snapshot does not match the verified app root.'
  }
  $eligible = @{}
  $eligible[$RootProcessId] = $rootRows[0]
  do {
    $added = $false
    foreach ($row in $matching) {
      $rowId = [int]$row.ProcessId
      $parentId = [int]$row.ParentProcessId
      if (-not $eligible.ContainsKey($rowId) -and $eligible.ContainsKey($parentId) -and
          $row.CreationDate.ToUniversalTime() -ge $eligible[$parentId].CreationDate.ToUniversalTime()) {
        $eligible[$rowId] = $row
        $added = $true
      }
    }
  } while ($added)
  return @($eligible.Values | Sort-Object ProcessId)
}

function Initialize-WindowTools {
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class QualificationWindows {
  public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)] private static extern IntPtr SendText(IntPtr hwnd, uint message, UIntPtr wparam, string text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)] private static extern IntPtr ReadText(IntPtr hwnd, uint message, UIntPtr wparam, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] private static extern IntPtr SendCommand(IntPtr hwnd, uint message, UIntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
  public static IntPtr[] ForProcess(int pid) {
    var matches = new List<IntPtr>();
    EnumWindows((hwnd, parameter) => { uint candidate; GetWindowThreadProcessId(hwnd, out candidate); if (candidate == pid) matches.Add(hwnd); return true; }, IntPtr.Zero);
    return matches.ToArray();
  }
  public static IntPtr[] Children(IntPtr parent) {
    var matches = new List<IntPtr>();
    EnumChildWindows(parent, (hwnd, parameter) => { matches.Add(hwnd); return true; }, IntPtr.Zero);
    return matches.ToArray();
  }
  public static void SetFilename(IntPtr hwnd, string path) {
    UIntPtr result;
    if (SendText(hwnd, 0x000C, UIntPtr.Zero, path, 0x22, 5000, out result) == IntPtr.Zero || result == UIntPtr.Zero)
      throw new InvalidOperationException("Native WM_SETTEXT failed or timed out.");
  }
  public static string ReadFilename(IntPtr hwnd) {
    var text = new StringBuilder(32768); UIntPtr result;
    if (ReadText(hwnd, 0x000D, (UIntPtr)text.Capacity, text, 0x22, 5000, out result) == IntPtr.Zero)
      throw new InvalidOperationException("Native WM_GETTEXT failed or timed out.");
    return text.ToString();
  }
  public static bool ClickAccept(IntPtr hwnd) {
    UIntPtr result;
    // The button may be destroyed while confirming. Actual dialog dismissal
    // and the independently checked project file determine success.
    return SendCommand(hwnd, 0x00F5, UIntPtr.Zero, IntPtr.Zero, 0x2, 5000, out result) != IntPtr.Zero;
  }
  public static string ClassName(IntPtr hwnd) { var text = new StringBuilder(256); GetClassName(hwnd, text, text.Capacity); return text.ToString(); }
  public static string Title(IntPtr hwnd) { var text = new StringBuilder(2048); GetWindowText(hwnd, text, text.Capacity); return text.ToString(); }
}
'@
}

function Get-WindowInventory([int[]]$ProcessIds = @($AppProcessId)) {
  return @($ProcessIds | ForEach-Object { [QualificationWindows]::ForProcess($_) } | ForEach-Object {
    $rect = [QualificationWindows+Rect]::new()
    [QualificationWindows]::GetWindowRect($_, [ref]$rect) | Out-Null
    $windowProcessId = [uint32]0
    [QualificationWindows]::GetWindowThreadProcessId($_, [ref]$windowProcessId) | Out-Null
    [pscustomobject]@{
      processId = $windowProcessId; ownerHandle = [QualificationWindows]::GetWindow($_, 4).ToInt64()
      handle = $_.ToInt64(); className = [QualificationWindows]::ClassName($_)
      title = [QualificationWindows]::Title($_); visible = [QualificationWindows]::IsWindowVisible($_)
      minimized = [QualificationWindows]::IsIconic($_)
      bounds = @{ left = $rect.Left; top = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
    }
  })
}

function Get-OwnedWindowInventory {
  $root = Assert-OwnedProcess
  $snapshot = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath, SessionId, CreationDate)
  $ownedProcesses = @(Get-EligibleAppProcesses $snapshot $AppProcessId $root.Path $root.SessionId $root.StartTime)
  $result.ownedProcesses = $ownedProcesses
  foreach ($window in @(Get-WindowInventory @($ownedProcesses | ForEach-Object { [int]$_.ProcessId }))) {
    $processRow = @($ownedProcesses | Where-Object ProcessId -EQ $window.processId)
    if ($processRow.Count -ne 1) { continue }
    $window | Add-Member -NotePropertyName processCreatedAtUtc -NotePropertyValue $processRow[0].CreationDate.ToUniversalTime().ToString('o')
    $window
  }
}

function Assert-OwnedDialog($Dialog) {
  # Chromium's Windows chooser runs in a utility child. Refresh the complete
  # verified ancestry before each UI mutation; never target arbitrary dialogs.
  $current = @(Get-OwnedWindowInventory | Where-Object {
    $_.visible -and $_.className -eq '#32770'
  })
  if ($current.Count -ne 1 -or $current[0].handle -ne $Dialog.handle -or
      $current[0].processId -ne $Dialog.processId -or
      $current[0].processCreatedAtUtc -ne $Dialog.processCreatedAtUtc) { throw 'Native dialog ownership changed or became ambiguous.' }
  $ownerHandle = [IntPtr]$current[0].ownerHandle
  for ($depth = 0; $depth -lt 16 -and $ownerHandle -ne [IntPtr]::Zero; $depth++) {
    $ownerProcessId = [uint32]0
    [QualificationWindows]::GetWindowThreadProcessId($ownerHandle, [ref]$ownerProcessId) | Out-Null
    if ($ownerProcessId -eq $AppProcessId) { return }
    if (-not @($result.ownedProcesses | Where-Object ProcessId -EQ $ownerProcessId).Count) { break }
    $ownerHandle = [QualificationWindows]::GetWindow($ownerHandle, 4)
  }
  throw 'Native dialog has no verified owner-window chain to the app root.'
}

function Save-WindowScreenshot([IntPtr]$WindowHandle, [string]$Name) {
  $rect = [QualificationWindows+Rect]::new()
  if (-not [QualificationWindows]::GetWindowRect($WindowHandle, [ref]$rect)) { throw 'Cannot read native window bounds.' }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 20 -or $height -lt 20) { throw 'Native window is not visibly sized.' }
  $bitmap = [Drawing.Bitmap]::new($width, $height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [Drawing.Size]::new($width, $height))
    $bitmap.Save((Join-Path $evidencePath $Name), [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-NativeControls($Dialog) {
  foreach ($control in [QualificationWindows]::Children([IntPtr]$Dialog.handle)) {
    if (-not [QualificationWindows]::IsChild([IntPtr]$Dialog.handle, $control)) { throw 'Native control left the verified dialog.' }
    $controlProcessId = [uint32]0
    [QualificationWindows]::GetWindowThreadProcessId($control, [ref]$controlProcessId) | Out-Null
    [pscustomobject]@{
      handle = $control.ToInt64(); parentHandle = [QualificationWindows]::GetParent($control).ToInt64()
      processId = $controlProcessId; controlId = [QualificationWindows]::GetDlgCtrlID($control)
      className = [QualificationWindows]::ClassName($control)
      visible = [QualificationWindows]::IsWindowVisible($control); enabled = [QualificationWindows]::IsWindowEnabled($control)
    }
  }
}

function Select-FileDialogControls($Controls, [long]$DialogHandle, [int]$DialogProcessId) {
  $byHandle = @{}
  foreach ($control in $Controls) {
    if ($byHandle.ContainsKey($control.handle)) { throw 'Ambiguous native control snapshot.' }
    $byHandle[$control.handle] = $control
  }
  $edits = @(); $buttons = @()
  foreach ($control in $Controls) {
    if (-not $control.visible -or -not $control.enabled) { continue }
    $current = $control; $filenameCombo = $false; $ownedAncestry = $false; $seen = @{}
    for ($depth = 0; $depth -lt 16 -and $null -ne $current; $depth++) {
      if ($seen.ContainsKey($current.handle) -or $current.processId -ne $DialogProcessId) { break }
      $seen[$current.handle] = $true
      if ($current.className -in @('ComboBox', 'ComboBoxEx32') -and $current.controlId -eq 1148 -and $current.visible -and $current.enabled) { $filenameCombo = $true }
      if ($current.parentHandle -eq $DialogHandle) { $ownedAncestry = $true; break }
      $current = $byHandle[$current.parentHandle]
    }
    if (-not $ownedAncestry) { continue }
    if ($control.className -eq 'Edit' -and $filenameCombo) { $edits += $control }
    if ($control.className -eq 'Button' -and $control.controlId -eq 1) { $buttons += $control }
  }
  return [pscustomobject]@{ edits = $edits; buttons = $buttons }
}

function Assert-OwnedControls($Dialog, $Selection) {
  Assert-OwnedDialog $Dialog
  $fresh = Select-FileDialogControls @(Get-NativeControls $Dialog) $Dialog.handle $Dialog.processId
  if ($fresh.edits.Count -ne 1 -or $fresh.buttons.Count -ne 1) { throw 'Native controls disappeared or became ambiguous.' }
  foreach ($kind in @('edits', 'buttons')) {
    foreach ($property in @('handle', 'parentHandle', 'processId', 'controlId', 'className')) {
      if ($fresh.$kind[0].$property -ne $Selection.$kind[0].$property) { throw 'Native control identity changed.' }
    }
  }
}

function Wait-NativeDialog {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $windows = @(Get-OwnedWindowInventory)
    $dialogs = @($windows | Where-Object { $_.visible -and $_.className -eq '#32770' })
    if ($dialogs.Count -gt 1) { throw 'More than one native dialog belongs to this app; refusing an ambiguous target.' }
    if ($dialogs.Count -eq 1) { Assert-OwnedDialog $dialogs[0]; return $dialogs[0] }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  Write-JsonFile 'windows.json' $windows
  throw 'Timed out waiting for the real Windows common file dialog.'
}

function Complete-FileDialog {
  if (-not [IO.Path]::IsPathRooted($FilePath)) { throw 'File dialog requires an absolute file path.' }
  if ($Action -eq 'Open' -and -not [IO.File]::Exists($FilePath)) { throw 'Input file does not exist.' }
  if ($Action -eq 'Save' -and [IO.File]::Exists($FilePath)) { throw 'Save target already exists; refusing overwrite.' }
  $dialog = Wait-NativeDialog
  $result.dialog = $dialog
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Assert-OwnedDialog $dialog
    $controls = @(Get-NativeControls $dialog)
    Write-JsonFile 'controls.json' $controls
    $selection = Select-FileDialogControls $controls $dialog.handle $dialog.processId
    if ($selection.edits.Count -gt 1 -or $selection.buttons.Count -gt 1) { throw 'Ambiguous native filename or accept control.' }
    if ($selection.edits.Count -eq 1 -and $selection.buttons.Count -eq 1) { break }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Native filename and accept controls did not become ready.' }
    Start-Sleep -Milliseconds 150
  } while ($true)
  $result.controls = $selection
  $result.controlMethod = 'owned native HWND messages'
  Assert-OwnedControls $dialog $selection
  [QualificationWindows]::SetFilename([IntPtr]$selection.edits[0].handle, $FilePath)
  $result.enteredPath = [QualificationWindows]::ReadFilename([IntPtr]$selection.edits[0].handle)
  if (-not [string]::Equals($result.enteredPath, $FilePath, [StringComparison]::Ordinal)) { throw 'Native filename edit did not retain the requested path.' }
  Save-WindowScreenshot ([IntPtr]$dialog.handle) 'dialog-filled.png'
  Assert-OwnedControls $dialog $selection
  [QualificationWindows]::SetForegroundWindow([IntPtr]$dialog.handle) | Out-Null
  if ([QualificationWindows]::GetForegroundWindow().ToInt64() -ne $dialog.handle) { throw 'The verified native file dialog is not active.' }
  $result.acceptMessageCompleted = [QualificationWindows]::ClickAccept([IntPtr]$selection.buttons[0].handle)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @(Get-OwnedWindowInventory | Where-Object { $_.visible -and $_.className -eq '#32770' })
    if ($remaining.Count -eq 0) { $result.dialogDismissed = $true; return }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  Write-JsonFile 'remaining-windows.json' $remaining
  throw 'Native file dialog did not close after confirmation.'
}

try {
  if ($Action -eq 'Preflight') {
    $result.appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    $result.userInteractive = [Environment]::UserInteractive
    $result.sessionId = (Get-Process -Id $PID).SessionId
    $result.existingProcesses = @(Get-Process -Name 'KerfDesk', 'LaserForge' -ErrorAction SilentlyContinue | ForEach-Object { @{ id = $_.Id; path = $_.Path } })
    $result.executableVersion = (Get-Item -LiteralPath $ExpectedExecutable).VersionInfo.ProductVersion
  } else {
    $owned = Assert-OwnedProcess
    $result.executable = $owned.Path
    if ($Action -eq 'Ownership') { $result.sessionId = $owned.SessionId }
    else {
      Initialize-WindowTools
      if ($Action -in @('Open', 'Save')) { Complete-FileDialog }
      else {
        $windows = @(Get-WindowInventory)
        $result.windows = $windows
        $main = @($windows | Where-Object { $_.visible -and -not $_.minimized -and $_.className -eq 'Chrome_WidgetWin_1' -and $_.title -like 'KerfDesk*' })
        if ($main.Count -ne 1) { throw "Expected one visible KerfDesk main window, found $($main.Count)." }
        $result.mainWindow = $main[0]
        if ($Action -eq 'Close') {
          if (-not [QualificationWindows]::PostMessage([IntPtr]$main[0].handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed.' }
        } else { Save-WindowScreenshot ([IntPtr]$main[0].handle) 'window.png' }
      }
    }
  }
  $result.ok = $true
} catch {
  $exitCode = 1
  $result.error = $_.Exception.Message
  $result.stack = $_.ScriptStackTrace
} finally {
  $result.finishedAt = [DateTime]::UtcNow.ToString('o')
  Write-JsonFile 'result.json' $result
}
exit $exitCode

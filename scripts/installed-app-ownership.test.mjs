import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test(
  'native file controls require the filename combo ancestry and retain exact owned identities',
  { skip: process.platform !== 'win32' },
  () => {
    const command = String.raw`
      $ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      $tokens = $null; $parseErrors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:QUALIFICATION_HELPER, [ref]$tokens, [ref]$parseErrors)
      if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
      foreach ($name in @('Select-FileDialogControls', 'Test-FilenameCombo', 'Assert-OwnedControls', 'Initialize-WindowTools')) {
        $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if ($null -eq $definition) { throw "Missing function $name" }
        . ([ScriptBlock]::Create($definition.Extent.Text))
      }
      # Compile P/Invoke signatures only. Do not call native window APIs or launch an app.
      Initialize-WindowTools
      function Control($handle, $parent, $class, $id, $process = 200, $visible = $true, $enabled = $true) {
        [pscustomobject]@{ handle = [long]$handle; parentHandle = [long]$parent; className = $class; controlId = $id; processId = $process; visible = $visible; enabled = $enabled }
      }
      $rows = @(
        (Control 400 100 'ComboBoxEx32' 1148), (Control 410 400 'ComboBox' 1001),
        (Control 420 410 'Edit' 1001), (Control 430 100 'Button' 1),
        (Control 440 100 'SearchEditBox' 1001), (Control 450 100 'ToolbarWindow32' 1001),
        (Control 460 470 'Edit' 1148), (Control 470 100 'ComboBox' 1136),
        (Control 480 410 'Edit' 1001 200 $false), (Control 490 410 'Edit' 1001 999),
        (Control 500 100 'Edit' 1148), (Control 510 100 'Button' 1 999)
      )
      $selected = Select-FileDialogControls $rows 100 200
      if (($selected.edits.handle -join ',') -ne '420' -or ($selected.buttons.handle -join ',') -ne '430') { throw 'Filename, search, address or accept discrimination failed' }
      $withoutCombo = @($rows | Where-Object handle -NE 400)
      if ((Select-FileDialogControls $withoutCombo 100 200).edits.Count -ne 0) { throw 'Orphaned filename control admitted' }
      $wrongOwner = @($withoutCombo + (Control 400 100 'ComboBoxEx32' 1148 999))
      if ((Select-FileDialogControls $wrongOwner 100 200).edits.Count -ne 0) { throw 'Foreign ancestor admitted' }
      $wrongCombo = @($withoutCombo + (Control 400 100 'ComboBoxEx32' 1136))
      if ((Select-FileDialogControls $wrongCombo 100 200).edits.Count -ne 0) { throw 'Wrong combo admitted' }
      $duplicate = @($rows + (Control 520 410 'Edit' 1001))
      if ((Select-FileDialogControls $duplicate 100 200).edits.Count -ne 2) { throw 'Ambiguous filename candidates hidden' }
      $rejected = $false
      try { Select-FileDialogControls @($rows + $rows[0]) 100 200 | Out-Null } catch { $rejected = $true }
      if (-not $rejected) { throw 'Duplicate handle admitted' }
      # windows-latest modern dialog: the filename combo reports control ID 0 and is
      # hosted by a FloatNotifySink; a control-ID-0 combo anywhere else stays unrelated.
      $modern = @(
        (Control 600 100 'DUIViewWndClassName' 0), (Control 610 600 'FloatNotifySink' 0),
        (Control 620 610 'ComboBox' 0), (Control 630 620 'Edit' 1001),
        (Control 640 600 'ComboBox' 0), (Control 650 640 'Edit' 1001),
        (Control 660 100 'ComboBoxEx32' 41477), (Control 670 660 'ComboBox' 41477), (Control 680 670 'Edit' 41477),
        (Control 690 100 'Button' 1), (Control 700 100 'Button' 2)
      )
      $modernSelected = Select-FileDialogControls $modern 100 200
      if (($modernSelected.edits.handle -join ',') -ne '630' -or ($modernSelected.buttons.handle -join ',') -ne '690') { throw 'Modern filename combo discrimination failed' }
      # Check revalidation with an in-memory inventory, never real local windows.
      $script:ownershipChecks = 0
      function Assert-OwnedDialog($Dialog) { $script:ownershipChecks++ }
      function Get-NativeControls($Dialog) { $script:fixtureRows }
      $dialog = [pscustomobject]@{ handle = [long]100; processId = 200 }
      $script:fixtureRows = $rows
      Assert-OwnedControls $dialog $selected
      $script:fixtureRows = @($rows | Where-Object handle -NE 420) + (Control 421 410 'Edit' 1001)
      $rejected = $false
      try { Assert-OwnedControls $dialog $selected } catch { $rejected = $true }
      if (-not $rejected -or $script:ownershipChecks -ne 2) { throw 'Changed control identity or missing dialog revalidation admitted' }
      Write-Output 'Native filename ancestry, unrelated controls, ambiguity and changed identities checked without desktop interaction'
    `;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        env: {
          ...process.env,
          QUALIFICATION_HELPER: fileURLToPath(
            new URL('./installed-file-dialog.ps1', import.meta.url),
          ),
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /without desktop interaction/);
  },
);

test(
  'native dialog process selection accepts owned descendants and rejects unrelated or reused identities',
  { skip: process.platform !== 'win32' },
  () => {
    // Load only the pure selection function, not the guarded native UI entrypoint.
    const command = String.raw`
      $ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      $tokens = $null; $parseErrors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:QUALIFICATION_HELPER, [ref]$tokens, [ref]$parseErrors)
      if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
      $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-EligibleAppProcesses' }, $true)
      if ($null -eq $definition) { throw 'Process ownership function missing' }
      . ([ScriptBlock]::Create($definition.Extent.Text))
      $exe = 'C:\runner\KerfDesk Installed\KerfDesk.exe'
      $stamp = [datetime]'2026-09-19T10:00:00Z'
      function Row($id, $parent, $path, $session, $seconds) {
        [pscustomobject]@{ ProcessId = $id; ParentProcessId = $parent; ExecutablePath = $path; SessionId = $session; CreationDate = $stamp.AddSeconds($seconds) }
      }
      $rows = @(
        (Row 300 200 $exe 2 2), (Row 100 1 $exe 2 0), (Row 200 100 $exe.ToUpperInvariant() 2 1),
        (Row 400 1 $exe 2 3), (Row 500 100 'C:\other\KerfDesk.exe' 2 3),
        (Row 600 100 $exe 99 3), (Row 700 500 $exe 2 4), (Row 800 200 $exe 2 -1),
        (Row 900 901 $exe 2 3), (Row 901 900 $exe 2 3), (Row 1000 100 $null 2 3)
      )
      $selected = @(Get-EligibleAppProcesses $rows 100 $exe 2 $stamp)
      if (($selected.ProcessId -join ',') -ne '100,200,300') { throw 'Owned descendant selection or exclusion failed' }
      $orphaned = @($rows | Where-Object ProcessId -NE 200)
      $selected = @(Get-EligibleAppProcesses $orphaned 100 $exe 2 $stamp)
      if (($selected.ProcessId -join ',') -ne '100') { throw 'Missing/reused parent admitted a child' }
      $rejected = 0
      try { Get-EligibleAppProcesses $rows 100 $exe 2 $stamp.AddSeconds(10) | Out-Null } catch { $rejected++ }
      try { Get-EligibleAppProcesses @($rows | Where-Object ProcessId -NE 100) 100 $exe 2 $stamp | Out-Null } catch { $rejected++ }
      try { Get-EligibleAppProcesses @($rows + (Row 100 1 $exe 2 0)) 100 $exe 2 $stamp | Out-Null } catch { $rejected++ }
      try { Get-EligibleAppProcesses $rows 100 'C:\wrong\KerfDesk.exe' 2 $stamp | Out-Null } catch { $rejected++ }
      if ($rejected -ne 4) { throw 'Expected stale, missing, duplicate and wrong-image root rejection' }
      Write-Output 'Owned descendants selected; unrelated, wrong image/session, stale ancestry and ambiguous roots rejected'
    `;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        env: {
          ...process.env,
          QUALIFICATION_HELPER: fileURLToPath(
            new URL('./installed-file-dialog.ps1', import.meta.url),
          ),
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Owned descendants selected/);
  },
);

test(
  'the filename is typed into the owned edit, because WM_SETTEXT alone loses the name',
  { skip: process.platform !== 'win32' },
  () => {
    // Measured on Windows 11 26200 against a real SaveFileDialog: setting the
    // edit's text with WM_SETTEXT left the modern dialog holding its own name,
    // so it returned DialogResult.Cancel and the caller got `untitled.lf2` —
    // the exact symptom the installer qualification reported from
    // windows-latest. Posting WM_CHAR per character is what a typing operator
    // produces and the same probe then returned the requested path. This pins
    // the typing so a future edit cannot quietly go back to WM_SETTEXT.
    const command = String.raw`
      $ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      $tokens = $null; $parseErrors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:QUALIFICATION_HELPER, [ref]$tokens, [ref]$parseErrors)
      if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
      $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Initialize-WindowTools' }, $true)
      if ($null -eq $definition) { throw 'Missing Initialize-WindowTools' }
      . ([ScriptBlock]::Create($definition.Extent.Text))
      Initialize-WindowTools
      # A real EDIT control of our own: no app, no file dialog, no desktop input.
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $box = New-Object System.Windows.Forms.TextBox
      $form.Controls.Add($box); $form.Opacity = 0; $form.ShowInTaskbar = $false
      $form.Show(); [System.Windows.Forms.Application]::DoEvents()
      $sep = [string][char]92
      $path = 'C:' + $sep + 'dir with spaces' + $sep + 'file-name_1.lf2'
      [QualificationWindows]::TypeFilename($box.Handle, $path)
      # WM_CHAR is posted, so pump until the control has consumed the queue.
      $deadline = [DateTime]::UtcNow.AddSeconds(10)
      do {
        [System.Windows.Forms.Application]::DoEvents()
        $read = [QualificationWindows]::ReadFilename($box.Handle)
        if ($read -eq $path) { break }
        Start-Sleep -Milliseconds 40
      } while ([DateTime]::UtcNow -lt $deadline)
      $form.Close()
      if ($read -ne $path) { throw "Typed filename did not land: [$read]" }
      # Clearing first is what makes the dialog's prefilled name go away.
      if (-not ($ast.Extent.Text -match 'ClearText\(hwnd\)')) { throw 'TypeFilename no longer clears the edit first' }
      if (-not ($ast.Extent.Text -match '0x0102')) { throw 'WM_CHAR posting is gone; the modern dialog will lose the name again' }
      Write-Output 'Typed filename landed in a real edit control'
    `;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        env: {
          ...process.env,
          QUALIFICATION_HELPER: fileURLToPath(
            new URL('./installed-file-dialog.ps1', import.meta.url),
          ),
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `${result.stdout}
${result.stderr}`,
    );
    assert.match(result.stdout, /Typed filename landed/);
  },
);

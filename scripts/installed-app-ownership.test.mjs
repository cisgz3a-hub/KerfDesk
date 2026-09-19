import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
        timeout: 15_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Owned descendants selected/);
  },
);

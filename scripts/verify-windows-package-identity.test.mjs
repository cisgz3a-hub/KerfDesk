import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const verifier = readFileSync(
  new URL('./verify-windows-package-identity.ps1', import.meta.url),
  'utf8',
);

test('checks the executable product and truthful author metadata', () => {
  assert.match(verifier, /\$expectedCompanyName = 'Johann Stolk'/);
  assert.match(verifier, /\$expectedProductName = 'KerfDesk'/);
  assert.match(verifier, /\$appFileDescription = 'KerfDesk'/);
  assert.match(verifier, /\$installerFileDescription = 'Focused GRBL CAM application/);
  assert.match(verifier, /\[ValidateSet\('App', 'Installer'\)\]/);
  assert.match(verifier, /\$copyrightSymbol = \[char\]0x00A9/);
  assert.match(
    verifier,
    /\$expectedLegalCopyright = "Copyright \$copyrightSymbol 2026 Johann Stolk"/,
  );
  assert.match(verifier, /\$versionInfo\.CompanyName/);
  assert.match(verifier, /\$versionInfo\.ProductName/);
  assert.match(verifier, /\$versionInfo\.FileDescription/);
  assert.match(verifier, /\$versionInfo\.LegalCopyright/);
  assert.doesNotMatch(verifier, /Get-AuthenticodeSignature/);
});

// The installer's FileDescription comes from package.json; only a native
// Windows release packages it, so a drifted pin otherwise fails at release.
test('pins the installer description that package.json builds', () => {
  const { description } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const pinned = verifier.match(/\$installerFileDescription = '([^']*)'/)?.[1];
  assert.equal(pinned, description);
});

// Upgrade qualification installs the published release first; its installer
// was built before ADR-607 and keeps the Windows-only description.
test('accepts the earlier description only for the published baseline installer', () => {
  const qualifier = readFileSync(
    new URL('./qualify-windows-installer.ps1', import.meta.url),
    'utf8',
  );
  assert.match(verifier, /\[switch\]\$Historical/);
  assert.match(
    verifier,
    /\$windowsOnlyInstallerFileDescription = '[^']*Web \+ Windows desktop from one codebase\.'/,
  );
  assert.match(verifier, /if \(\$Historical -and \$Kind -ne 'Installer'\) \{ throw/);
  assert.match(
    qualifier,
    /\$historical = \$Scenario -eq 'HistoricalUpgrade' -and \$candidate -eq \$Installer/,
  );
  assert.match(qualifier, /-Kind Installer -Historical:\$historical/);
});

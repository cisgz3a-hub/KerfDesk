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

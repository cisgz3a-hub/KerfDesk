import test from 'node:test';
import assert from 'node:assert/strict';
import { scannedPairing } from '../public/control-scanner-link.js';

const production = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
const current = 'https://phone-fixture.test';
const device = 'dae5d95f-d68b-4cfe-809c-af23bf8fa629';
const code = 'ScannerTest123';
const fragment = `#device=${device}&code=${code}`;
const link = production + '/control' + fragment;

test('scanned pairing accepts the production page and the current secure origin only', () => {
  for (const origin of [
    production,
    current,
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://[::1]:8787',
  ])
    assert.deepEqual(scannedPairing(origin + '/control' + fragment, origin), { device, code });
  assert.deepEqual(scannedPairing(link, current), { device, code });
  assert.deepEqual(
    scannedPairing(
      production + '/control#code=' + code + '&device=' + device.toUpperCase(),
      current,
    ),
    { device: device.toUpperCase(), code },
  );
});

const rejected = [
  ['foreign origin', 'https://outside.test/control' + fragment],
  [
    'production lookalike',
    'https://kerfdesk-phone-control.cisgz3a.workers.dev.outside.test/control' + fragment,
  ],
  ['username', production.replace('https://', 'https://person@') + '/control' + fragment],
  ['password', production.replace('https://', 'https://person:password@') + '/control' + fragment],
  ['query', production + '/control?device=' + device + fragment],
  ['trailing slash', production + '/control/' + fragment],
  ['different path', production + '/mcp' + fragment],
  ['normalised path', production + '/other/../control' + fragment],
  ['encoded path', production + '/%63ontrol' + fragment],
  ['backslashes', production.replaceAll('/', '\\') + '\\control' + fragment],
  ['extra fragment field', link + '&scope=control'],
  ['duplicate device', link + '&device=' + device],
  ['duplicate code', link + '&code=' + code],
  ['encoded duplicate', link + '&%63ode=' + code],
  ['missing device', production + '/control#code=' + code],
  ['missing code', production + '/control#device=' + device],
  ['invalid device', production + '/control#device=computer&code=' + code],
  [
    'invalid version',
    production + '/control#device=dae5d95f-d68b-0cfe-809c-af23bf8fa629&code=' + code,
  ],
  [
    'invalid variant',
    production + '/control#device=dae5d95f-d68b-4cfe-709c-af23bf8fa629&code=' + code,
  ],
  ['short code', production + '/control#device=' + device + '&code=short'],
  ['long code', production + '/control#device=' + device + '&code=' + 'a'.repeat(25)],
  ['non-code characters', production + '/control#device=' + device + '&code=Scanner%20Test123'],
  ['missing fragment', production + '/control'],
  ['relative link', '/control' + fragment],
  ['javascript URL', 'javascript:alert(1)' + fragment],
  ['whitespace', ' ' + link],
  ['embedded newline', link.replace(code, 'Scanner\nTest123')],
  ['embedded tab', link.replace(code, 'Scanner\tTest123')],
  ['oversized payload', link + 'x'.repeat(1024)],
];
for (const [name, value] of rejected)
  test('scanned pairing rejects ' + name, () => assert.equal(scannedPairing(value, current), null));

test('scanned pairing rejects insecure non-local origins, different local ports and non-string payloads', () => {
  assert.equal(
    scannedPairing('http://phone-fixture.test/control' + fragment, 'http://phone-fixture.test'),
    null,
  );
  assert.equal(
    scannedPairing('http://localhost:8788/control' + fragment, 'http://localhost:8787'),
    null,
  );
  for (const value of [null, undefined, 123, {}, [], ''])
    assert.equal(scannedPairing(value, current), null);
});

test('scanned pairing matches the existing fragment reader sentinel UUID contract', () => {
  for (const sentinel of [
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ])
    assert.deepEqual(
      scannedPairing(production + '/control#device=' + sentinel + '&code=' + code, current),
      { device: sentinel, code },
    );
});

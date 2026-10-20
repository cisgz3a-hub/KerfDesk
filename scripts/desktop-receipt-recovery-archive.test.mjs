import assert from 'node:assert/strict';
import test from 'node:test';
import { archive } from './desktop-receipt-recovery-test-support.mjs';
import { readRecoveryArchive } from './desktop-receipt-recovery-archive.mjs';

for (const method of [0, 8])
  test('reads exact bounded data members, compression ' + method, () => {
    const bytes = archive([
      {
        name: 'runner/public-desktop-delivery/public-delivery.json',
        text: '{"status":"verified"}',
        method,
      },
      { name: 'runner/private-script.mjs', text: 'throw Error("must never execute")' },
    ]);
    const read = readRecoveryArchive(bytes);
    assert.equal(
      read('public-desktop-delivery/public-delivery.json').toString(),
      '{"status":"verified"}',
    );
    assert.throws(() => read('missing.json'));
    assert.throws(() => read('public-desktop-delivery/public-delivery.json', 2));
  });
for (const name of [
  '../report.json',
  '/report.json',
  'C:/report.json',
  'safe/../report.json',
  'safe\\report.json',
  'safe/./report.json',
  'safe/\u0000report.json',
])
  test('rejects unsafe ZIP member ' + JSON.stringify(name), () =>
    assert.throws(() => readRecoveryArchive(archive([{ name }]))),
  );
for (const items of [
  [{ name: 'report.json' }, { name: 'report.json' }],
  [{ name: 'report.json' }, { name: 'REPORT.json' }],
  [{ name: 'report.json', attributes: (0xa000 << 16) >>> 0 }],
  [{ name: 'report.json', size: 300_000_001 }],
  [{ name: 'report.json', flags: 1 }],
  [{ name: 'report.json', method: 12 }],
])
  test(
    'rejects duplicate, symlink, oversized or unsupported archive records ' + JSON.stringify(items),
    () => {
      assert.throws(() => readRecoveryArchive(archive(items)));
    },
  );
test('refuses suffix ambiguity, conflicting local names, wrong sizes and truncated records', () => {
  assert.throws(() =>
    readRecoveryArchive(archive([{ name: 'one/report.json' }, { name: 'two/report.json' }]))(
      'report.json',
    ),
  );
  assert.throws(() =>
    readRecoveryArchive(archive([{ name: 'report.json', localName: 'different.json' }]))(
      'report.json',
    ),
  );
  assert.throws(() =>
    readRecoveryArchive(archive([{ name: 'report.json', size: 3 }]))('report.json'),
  );
  const bytes = archive([{ name: 'report.json' }]);
  for (const short of [Buffer.alloc(0), bytes.subarray(0, bytes.length - 1)])
    assert.throws(() => readRecoveryArchive(short));
  const excessive = Buffer.from(bytes);
  excessive.writeUInt16LE(4097, excessive.length - 12);
  assert.throws(() => readRecoveryArchive(excessive));
});

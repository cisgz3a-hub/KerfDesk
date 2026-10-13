import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appShellVersion } from '../scripts/app-shell-version.mjs';

const phone = { js: 'phone-bundle', css: 'phone-styles' };
const shell = new Map([
  ['app/static/icon.svg', Buffer.from('<svg>old icon</svg>')],
  ['app/static/manifest.webmanifest', Buffer.from('{"name":"KerfDesk"}')],
  ['public/app/icon-maskable-512.png', Buffer.from([137, 80, 78, 71])],
]);

describe('remote offline shell version', () => {
  it('refreshes the offline cache when only a vector, bitmap or manifest changes', () => {
    const before = appShellVersion(phone, shell);
    for (const [name, bytes] of shell) {
      const changed = new Map(shell);
      changed.set(name, Buffer.concat([bytes, Buffer.from('updated')]));
      assert.notEqual(appShellVersion(phone, changed), before, name);
    }
  });

  it('keeps identical content stable regardless of asset discovery order', () => {
    assert.equal(
      appShellVersion(phone, new Map([...shell].reverse())),
      appShellVersion(phone, shell),
    );
  });
});

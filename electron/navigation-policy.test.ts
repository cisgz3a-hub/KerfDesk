import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// main.ts imports the native `electron` module and cannot be unit-imported under
// Vitest, so the navigation policy wiring is asserted at the source level — the
// same precedent as csp-policy.test.ts. The trusted-origin decision itself is
// covered by trusted-renderer-policy.test.ts; the runtime handler behavior is
// only fully verified on packaged Windows (WORKFLOW F-DESK3).
function readMain(): string {
  return readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
}

describe('navigation policy wiring', () => {
  it('guards both will-navigate and will-redirect through shouldAllowNavigation', () => {
    const main = readMain();
    expect(main).toContain("'will-navigate'");
    expect(main).toContain("'will-redirect'");
    expect(main).toContain('shouldAllowNavigation');
  });

  it('does not fail open by dereferencing event.url.length before preventDefault', () => {
    // event.url can be undefined; reading `.length` throws inside the handler
    // before preventDefault runs, so the navigation proceeds — a fail-open on a
    // security control (ELE-07). The always-provided `url` argument is used
    // instead.
    expect(readMain()).not.toContain('event.url.length');
  });
});

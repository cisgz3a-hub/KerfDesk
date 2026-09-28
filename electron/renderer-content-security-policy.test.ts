import { describe, expect, it } from 'vitest';
import { rendererContentSecurityPolicy } from './renderer-content-security-policy';

const POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

describe('renderer Content-Security-Policy', () => {
  it('leaves the production policy untouched', () => {
    expect(rendererContentSecurityPolicy(POLICY, false)).toBe(POLICY);
  });

  it("adds only the dev server's inline preamble allowance to script-src", () => {
    expect(rendererContentSecurityPolicy(POLICY, true)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    );
  });
});

/**
 * T2-107: Content-Security-Policy builder. Pre-T2-107 the CSP at
 * `electron/main.ts:190-191` was hard-coded with both `'unsafe-eval'`
 * and `'unsafe-inline'` for `script-src`, plus `'unsafe-inline'`
 * for `style-src`. For an Electron app handling user files (SVG /
 * DXF / image imports), CSP is the last line of defence against
 * XSS via malicious content. Audit 5B Startup verdict + CSP debt.
 *
 * T2-107 ships the centralised builder + a `'compatible'` vs
 * `'strict'` mode + tests that pin both. The actual flip from
 * compatible→strict is filed as T2-107-followup since it requires
 * a dependency audit (some libraries may use `eval` or
 * `new Function`; some emit inline `<style>` from CSS-in-JS) and
 * runtime smoke-testing of every major user flow.
 */

export type CspMode = 'dev' | 'compatible' | 'strict';

/**
 * One CSP directive — the key name plus its value tokens. Order
 * within the value array is preserved on serialise.
 */
export interface CspDirective {
  name: string;
  values: string[];
}

export interface CspPolicy {
  mode: CspMode;
  directives: CspDirective[];
}

const ALWAYS_DEFAULT: CspDirective[] = [
  { name: 'default-src', values: ["'self'"] },
  { name: 'object-src', values: ["'none'"] },
  { name: 'frame-src', values: ["'none'"] },
  { name: 'base-uri', values: ["'self'"] },
];

const COMMON_RESOURCE_DIRECTIVES: CspDirective[] = [
  { name: 'img-src', values: ["'self'", 'data:', 'blob:', 'indexeddb:'] },
  { name: 'font-src', values: ["'self'", 'data:'] },
  { name: 'connect-src', values: ["'self'", 'ws:', 'wss:', 'https:'] },
  { name: 'worker-src', values: ["'self'", 'blob:'] },
];

/**
 * Build a CSP policy for `mode`. The two production-relevant modes:
 *
 * - `compatible`: includes `'unsafe-inline'` and `'unsafe-eval'`
 *   for `script-src`, and `'unsafe-inline'` for `style-src`. This
 *   is the pre-T2-107 baseline; it must be kept until the
 *   dependency audit (T2-107-followup) confirms which packages
 *   actually need eval / inline.
 *
 * - `strict`: removes `'unsafe-eval'` from script-src AND removes
 *   `'unsafe-inline'` from style-src. Inline styles must come from
 *   nonced/hashed `<style>` tags, and any `eval`-based code path
 *   must be replaced.
 *
 * - `dev`: loosest — Vite's HMR pre-7.0 pulls eval-style code paths
 *   so `'unsafe-eval'` stays.
 */
export function buildCspPolicy(mode: CspMode): CspPolicy {
  const scriptSrc: string[] = ["'self'"];
  const styleSrc: string[] = ["'self'"];

  switch (mode) {
    case 'dev':
      scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
      styleSrc.push("'unsafe-inline'");
      break;
    case 'compatible':
      scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
      styleSrc.push("'unsafe-inline'");
      break;
    case 'strict':
      // No unsafe-eval. Inline scripts blocked unless nonce/hash is
      // injected at runtime via Electron's webRequest.onHeadersReceived;
      // the wiring layer threads nonces in T2-107-followup.
      break;
  }

  return {
    mode,
    directives: [
      ...ALWAYS_DEFAULT,
      { name: 'script-src', values: scriptSrc },
      { name: 'style-src', values: styleSrc },
      ...COMMON_RESOURCE_DIRECTIVES,
    ],
  };
}

/**
 * Serialise a policy to the CSP header format:
 *   `directive value1 value2; directive value1; ...`
 * One space between values, `; ` between directives. Trailing
 * semicolon is omitted (browsers tolerate either, but the canonical
 * form is no trailing).
 */
export function serializeCsp(policy: CspPolicy): string {
  return policy.directives
    .map((d) => `${d.name} ${d.values.join(' ')}`)
    .join('; ');
}

export function getDirective(policy: CspPolicy, name: string): CspDirective | null {
  return policy.directives.find((d) => d.name === name) ?? null;
}

export function directiveAllowsToken(
  policy: CspPolicy,
  name: string,
  token: string,
): boolean {
  return getDirective(policy, name)?.values.includes(token) ?? false;
}

/**
 * Audit predicate the test suite uses to verify the strict policy:
 * STRICT must NOT permit `'unsafe-eval'` anywhere.
 */
export function policyForbidsUnsafeEval(policy: CspPolicy): boolean {
  return !policy.directives.some(
    (d) => d.name === 'script-src' && d.values.includes("'unsafe-eval'"),
  );
}

/**
 * STRICT must NOT permit `'unsafe-inline'` for style-src (the
 * style-side audit goal).
 */
export function policyForbidsUnsafeInlineStyles(policy: CspPolicy): boolean {
  return !policy.directives.some(
    (d) => d.name === 'style-src' && d.values.includes("'unsafe-inline'"),
  );
}

/**
 * Mode chosen at runtime. Defaults to `'compatible'` in production —
 * flip to `'strict'` after T2-107-followup audit confirms no
 * library needs eval/inline. Returns `'dev'` when running under
 * Vite dev server.
 */
export function pickCspMode(env: { isDev: boolean; strictOverride?: boolean }): CspMode {
  if (env.isDev) return 'dev';
  if (env.strictOverride === true) return 'strict';
  return 'compatible';
}

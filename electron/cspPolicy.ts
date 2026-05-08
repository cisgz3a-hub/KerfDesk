/**
 * T2-107 / T3-8: Content-Security-Policy builder for the Electron shell.
 *
 * The Electron main process must import this during `electron:compile`, so
 * the source of truth lives under `electron/`. `src/security/CspPolicy.ts`
 * re-exports it for existing audit helpers and tests.
 */

export type CspMode = 'dev' | 'compatible' | 'strict';

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
      // T3-8: production removes unsafe script execution. Inline styles stay
      // temporarily because the current React UI uses style attributes heavily;
      // removing style-src unsafe-inline needs a separate nonce/style migration.
      styleSrc.push("'unsafe-inline'");
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

export function policyForbidsUnsafeEval(policy: CspPolicy): boolean {
  return !policy.directives.some(
    (d) => d.name === 'script-src' && d.values.includes("'unsafe-eval'"),
  );
}

export function policyForbidsUnsafeInlineScripts(policy: CspPolicy): boolean {
  return !policy.directives.some(
    (d) => d.name === 'script-src' && d.values.includes("'unsafe-inline'"),
  );
}

export function policyForbidsUnsafeInlineStyles(policy: CspPolicy): boolean {
  return !policy.directives.some(
    (d) => d.name === 'style-src' && d.values.includes("'unsafe-inline'"),
  );
}

export function pickCspMode(env: { isDev: boolean; strictOverride?: boolean }): CspMode {
  if (env.isDev) return 'dev';
  if (env.strictOverride === false) return 'compatible';
  return 'strict';
}

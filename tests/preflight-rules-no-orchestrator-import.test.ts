/**
 * T1-227: preflight rules must not import the Preflight orchestrator.
 *
 * `Preflight.ts` imports every rule. If a rule imports shared types or codes
 * back from `../Preflight`, Madge reports one cycle per rule. Shared rule
 * contracts belong in the neutral `PreflightContext.ts` module.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const rulesDir = 'src/core/preflight/rules';

test('preflight shared contracts live outside the orchestrator', () => {
  const sharedModule = 'src/core/preflight/PreflightContext.ts';
  assert.equal(existsSync(sharedModule), true, 'PreflightContext.ts exists');

  const src = readFileSync(sharedModule, 'utf8');
  assert.match(src, /T1-227/);
  assert.match(src, /export interface PreflightContext/);
  assert.match(src, /export interface PreflightResult/);
  assert.match(src, /export const PREFLIGHT_CODES/);
});

test('rule files do not import from Preflight.ts', () => {
  const offenders: string[] = [];
  for (const name of readdirSync(rulesDir)) {
    if (!name.endsWith('.ts')) continue;
    const path = join(rulesDir, name);
    const src = readFileSync(path, 'utf8');
    if (/from\s+['"]\.\.\/Preflight(?:\.ts)?['"]/.test(src)) {
      offenders.push(path);
    }
  }

  assert.deepEqual(offenders, []);
});

test('Preflight orchestrator re-exports shared contracts for existing callers', () => {
  const src = readFileSync('src/core/preflight/Preflight.ts', 'utf8');

  assert.match(src, /export\s+\{\s*PREFLIGHT_CODES\s*\}/);
  assert.match(src, /export\s+type\s+\{\s*PreflightContext,\s*PreflightResult,\s*PreflightSeverity/);
  assert.doesNotMatch(src, /export interface PreflightContext/);
  assert.doesNotMatch(src, /export interface PreflightResult/);
});

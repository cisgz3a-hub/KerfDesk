import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const validator = join(process.cwd(), 'scripts/validate-release-tag.mjs');
const RELEASE_TAG_VALIDATOR_TIMEOUT_MS = 5_000;
const RELEASE_TAG_TIMEOUT_PROBE_MS = 100;
const RELEASE_TAG_POLICY_TEST_TIMEOUT_MS = 15_000;

function git(cwd: string, ...args: ReadonlyArray<string>): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function validate(
  cwd: string,
  lane: 'stable' | 'preview',
  tag: string,
  validatorPath = validator,
  timeout = RELEASE_TAG_VALIDATOR_TIMEOUT_MS,
) {
  return spawnSync(process.execPath, [validatorPath, lane, tag], {
    cwd,
    encoding: 'utf8',
    timeout,
  });
}

describe('desktop release tag validator', () => {
  it('reports a validator subprocess that exceeds its execution budget', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kerfdesk-release-tag-timeout-'));
    const hangingValidator = join(fixture, 'hanging-validator.mjs');

    try {
      writeFileSync(hangingValidator, 'setInterval(() => {}, 1_000);\n');
      const result = validate(
        fixture,
        'stable',
        'v1.2.3',
        hangingValidator,
        RELEASE_TAG_TIMEOUT_PROBE_MS,
      );

      expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it(
    'keeps stable and Preview lanes disjoint and requires annotated tags',
    () => {
      const repo = mkdtempSync(join(tmpdir(), 'kerfdesk-release-tags-'));

      try {
        git(repo, 'init');
        git(repo, 'config', 'user.name', 'KerfDesk Test');
        git(repo, 'config', 'user.email', 'test@kerfdesk.invalid');
        writeFileSync(join(repo, 'seed.txt'), 'release tag fixture\n');
        git(repo, 'add', 'seed.txt');
        git(repo, 'commit', '-m', 'seed');
        git(repo, 'tag', '-a', 'v1.2.3', '-m', 'stable');
        git(repo, 'tag', '-a', 'v1.2.3-preview.1', '-m', 'preview');
        git(repo, 'tag', 'v1.2.4');
        git(repo, 'tag', 'v1.2.3-preview.2');
        git(repo, 'tag', '-a', 'v01.2.3', '-m', 'leading zero');
        git(repo, 'tag', '-a', 'v1.2.3-preview.01', '-m', 'leading zero preview');

        expect(validate(repo, 'stable', 'v1.2.3').status).toBe(0);
        expect(validate(repo, 'preview', 'v1.2.3-preview.1').status).toBe(0);
        expect(validate(repo, 'stable', 'v1.2.3-preview.1').status).not.toBe(0);
        expect(validate(repo, 'preview', 'v1.2.3').status).not.toBe(0);
        expect(validate(repo, 'stable', 'v1.2.4').status).not.toBe(0);
        expect(validate(repo, 'preview', 'v1.2.3-preview.2').status).not.toBe(0);
        expect(validate(repo, 'stable', 'v01.2.3').status).not.toBe(0);
        expect(validate(repo, 'preview', 'v1.2.3-preview.01').status).not.toBe(0);
        expect(validate(repo, 'stable', 'v9.9.9').status).not.toBe(0);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    RELEASE_TAG_POLICY_TEST_TIMEOUT_MS,
  );
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const validator = join(process.cwd(), 'scripts/validate-release-tag.mjs');

function git(cwd: string, ...args: ReadonlyArray<string>): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function validate(cwd: string, lane: 'stable' | 'preview', tag: string) {
  return spawnSync(process.execPath, [validator, lane, tag], {
    cwd,
    encoding: 'utf8',
  });
}

describe('desktop release tag validator', () => {
  it('keeps stable and Preview lanes disjoint and requires annotated tags', () => {
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
  });
});

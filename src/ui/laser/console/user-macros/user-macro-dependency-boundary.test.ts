import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRODUCTION_FILE_PATTERN = /\.(?:ts|tsx)$/u;
const IMPORT_PATTERN = /\b(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/gu;
const FORBIDDEN_RUNTIME_IDENTIFIERS = [
  'runStartJobFlow',
  'startJob',
  'safeWrite',
  'framedRun',
  'frameVerification',
  'createStreamer',
  'useLaserStore',
] as const;

describe('user macro dependency boundary', () => {
  it('keeps production modules isolated from Start, Frame, store, and transport authority', () => {
    const directory = resolve(process.cwd(), 'src/ui/laser/console/user-macros');
    const files = readdirSync(directory).filter(
      (file) => PRODUCTION_FILE_PATTERN.test(file) && !file.includes('.test.'),
    );

    for (const file of files) {
      const source = readFileSync(resolve(directory, file), 'utf8');
      const imports = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
      const outsideBoundary = imports.filter(
        (value) => value !== 'react' && value?.startsWith('./') !== true,
      );
      expect(outsideBoundary, `${file} imports outside its injected UI boundary`).toEqual([]);
      for (const identifier of FORBIDDEN_RUNTIME_IDENTIFIERS) {
        expect(source, `${file} references forbidden ${identifier}`).not.toMatch(
          new RegExp(`\\b${identifier}\\b`, 'u'),
        );
      }
    }
  });
});

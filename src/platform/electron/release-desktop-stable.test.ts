import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPECTED_ACTION_REFERENCES = [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
  'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
] as const;
const FULL_SHA_ACTION_REFERENCE = /^[^@\s]+@[0-9a-f]{40}\s+#\s+v\d+$/;

describe('stable desktop release action references', () => {
  const workflow = readFileSync(
    join(process.cwd(), '.github/workflows/release-desktop-stable.yml'),
    'utf8',
  );

  it('pins every external action to an approved full commit SHA', () => {
    const references = [...workflow.matchAll(/^\s+uses:\s+(.+)$/gm)].map((match) =>
      match[1]?.trim(),
    );

    expect(references).toHaveLength(6);
    expect(references.every((reference) => FULL_SHA_ACTION_REFERENCE.test(reference ?? ''))).toBe(
      true,
    );
    expect([...new Set(references)].sort()).toEqual([...EXPECTED_ACTION_REFERENCES].sort());
  });
});

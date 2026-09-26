// Trace parity oracle (ADR-438 amendment): the gate for output-identical speed work.
//
// Gated on TRACE_PARITY=1 so a stray `pnpm test` is a no-op. It traces the
// oracle corpus in all six presets, hashes each canonical result and compares
// the hashes with a frozen base file recorded from the base commit.
//
//   TRACE_PARITY=1                 light corpus (perceptual fixtures + noise192)
//   TRACE_PARITY_HEAVY=1           also owl, hummingbird, noise1024, value1024
//   TRACE_PARITY_RECORD=1          write the hashes into the base file instead of comparing
//   TRACE_PARITY_ONLY=a,b          restrict to these case names
//   TRACE_PARITY_PRESETS=x,y       restrict to these presets
//   TRACE_PARITY_DIR               lab folder (default the speed program's lfbake folder)
//   TRACE_PARITY_BASE              base file (default <dir>/speed2/oracle-base.json)
//
// Every run writes <dir>/speed2/oracle-current.json. The first mismatching case's
// canonical text is written next to it so the difference can be inspected.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { TraceOptions } from '../../core/trace';
import {
  PARITY_LAB_DIR,
  PARITY_PRESETS,
  canonicalTraceHash,
  canonicalTraceText,
  parityCases,
  parityKey,
} from './trace-parity-oracle';

const RUN = process.env['TRACE_PARITY'] === '1';
const HEAVY = process.env['TRACE_PARITY_HEAVY'] === '1';
const RECORD = process.env['TRACE_PARITY_RECORD'] === '1';
const OUT_DIR = `${PARITY_LAB_DIR}/speed2`;
const BASE_FILE = process.env['TRACE_PARITY_BASE'] ?? `${OUT_DIR}/oracle-base.json`;

function listFilter(name: string): ReadonlySet<string> | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : new Set(raw.split(','));
}

const onlyCases = listFilter('TRACE_PARITY_ONLY');
const onlyPresets = listFilter('TRACE_PARITY_PRESETS');

type HashFile = { readonly hashes: Record<string, string>; readonly note?: string };

function readHashes(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return (JSON.parse(readFileSync(path, 'utf8')) as HashFile).hashes;
}

const cases = RUN
  ? parityCases().filter(
      (entry) => (HEAVY || !entry.heavy) && (onlyCases === undefined || onlyCases.has(entry.name)),
    )
  : [];
const presets = PARITY_PRESETS.filter((preset) => onlyPresets?.has(preset) ?? true);
const rows = cases.flatMap((entry) => presets.map((preset) => ({ entry, preset })));
const base = RUN && !RECORD ? readHashes(BASE_FILE) : {};
const current: Record<string, string> = {};
let failureDumped = false;

describe.skipIf(!RUN)('trace parity oracle', () => {
  afterAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = { recordedAt: new Date().toISOString(), cwd: process.cwd() };
    writeFileSync(
      `${OUT_DIR}/oracle-current.json`,
      `${JSON.stringify({ ...stamp, hashes: current }, null, 1)}\n`,
    );
    if (RECORD) {
      const merged = { ...readHashes(BASE_FILE), ...current };
      writeFileSync(BASE_FILE, `${JSON.stringify({ ...stamp, hashes: merged }, null, 1)}\n`);
    }
  });

  it.each(rows.map((row) => [parityKey(row.entry.name, row.preset), row] as const))(
    '%s traces byte-identically to the base',
    async (key, { entry, preset }) => {
      const options = TRACE_PRESETS[preset] as TraceOptions;
      const paths = await traceImageToColoredPaths(entry.image(), options);
      const hash = canonicalTraceHash(paths);
      current[key] = hash;
      if (RECORD) return;
      const expected = base[key];
      expect(expected, `no base hash for ${key}; record it from the base commit`).toBeDefined();
      if (hash !== expected && !failureDumped) {
        failureDumped = true;
        mkdirSync(OUT_DIR, { recursive: true });
        const file = `${OUT_DIR}/first-failure-${key.replace(/[^a-z0-9]+/gi, '_')}.txt`;
        writeFileSync(file, canonicalTraceText(paths));
      }
      expect(hash, key).toBe(expected);
    },
    600_000,
  );
});

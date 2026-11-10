import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { isRotaryActive, rotaryYScale } from '../../core/devices';
import type { JobOriginPlacement } from '../../core/job';
import type * as SurfaceFeed from '../../core/output/rotary-surface-feed';
import type { Project } from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { emitGcode } from './emit-gcode';

// ADR-694 returning user: rotary projects saved by the published 1.0.30
// (ffd9fe66b, schema 21) — chuck, reversed chuck, scaled roller,
// surface-calibrated roller and a disabled rotary, each with a cut, a fill and
// an image — open on this build and emit the same bytes 1.0.30 emitted, for
// Absolute, Current Position and User Origin. The fixture holds the files and
// a SHA-256 of each program with its comment lines dropped; 1.0.30 itself
// produced both.
//
// ADR-127 Amendment 2 changes the feed of rotary line, cut and fill moves on
// purpose: each now moves the part's surface at the layer speed, so these
// projects burn darker or lighter than 1.0.30 burned them. With the feed match
// switched off the program must still hash to 1.0.30's, so geometry, power,
// order and every image row are unchanged; with it on, only F words may
// differ, image rows not at all, and each lit move's new F must move the
// surface at the speed 1.0.30 wrote for it.

const feedMatch = vi.hoisted(() => ({ off: false }));
vi.mock('../../core/output/rotary-surface-feed', async (importOriginal) => {
  const actual = await importOriginal<typeof SurfaceFeed>();
  return {
    ...actual,
    rotaryFeedMatchFor: (...args: Parameters<typeof actual.rotaryFeedMatchFor>) =>
      feedMatch.off ? undefined : actual.rotaryFeedMatchFor(...args),
  };
});

type Golden = {
  readonly projects: Readonly<Record<string, string>>;
  readonly gcodeSha256: Readonly<Record<string, string>>;
};

const GOLDEN: Golden = JSON.parse(
  gunzipSync(
    readFileSync(resolve('src/__fixtures__/returning-user', '1.0.30-rotary.golden.json.gz')),
  ).toString('utf8'),
);

const PLACEMENTS: Readonly<Record<string, JobOriginPlacement | undefined>> = {
  absolute: undefined,
  'current-position': {
    startFrom: 'current-position',
    anchor: 'center',
    currentPosition: { x: 100, y: 80 },
  },
  'user-origin': { startFrom: 'user-origin', anchor: 'front-left' },
};

function opened(name: string): Project {
  const saved = GOLDEN.projects[name];
  if (saved === undefined) throw new Error(`Missing golden project ${name}`);
  expect(JSON.parse(saved).schemaVersion).toBe(21);
  const result = deserializeProject(saved);
  if (result.kind !== 'ok') throw new Error(`${name} did not open: ${result.kind}`);
  return result.project;
}

function program(
  project: Project,
  placement: JobOriginPlacement | undefined,
  matched = true,
): string {
  feedMatch.off = !matched;
  try {
    return emitGcode(project, placement === undefined ? {} : { jobOrigin: placement }).gcode;
  } finally {
    feedMatch.off = false;
  }
}

function sha(gcode: string): string {
  const burn = gcode
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(';'))
    .join('\n');
  return createHash('sha256').update(burn).digest('hex');
}

const FEED_WORD = / ?F\d+(?:\.\d+)?/;

type Modal = { x: number; y: number; feed: number; power: number; motion: string };

/** Applies one line to the modal state; the XY step when it burns, else null. */
function step(line: string, state: Modal): { readonly dx: number; readonly dy: number } | null {
  const before = { x: state.x, y: state.y };
  for (const word of line.replace(/;.*$/, '').match(/[A-Z]-?\d*\.?\d+/g) ?? []) {
    const value = Number(word.slice(1));
    if (word[0] === 'G' && (value === 0 || value === 1)) state.motion = `G${value}`;
    if (word[0] === 'X') state.x = value;
    if (word[0] === 'Y') state.y = value;
    if (word[0] === 'F') state.feed = value;
    if (word[0] === 'S') state.power = value;
  }
  const lit = state.motion === 'G1' && state.power > 0;
  return lit ? { dx: state.x - before.x, dy: state.y - before.y } : null;
}

/** Only F words differ; image rows not at all; each lit move of 0.25 mm or
 *  more moves the surface at the feed 1.0.30 wrote for it (ADR-127 Amd 2).
 *  Returns how many lines changed. */
function expectOnlySurfaceMatchedFeeds(before: string, after: string, k: number): number {
  const old = before.split('\n');
  const now = after.split('\n').filter((line) => !line.startsWith('; rotary:'));
  expect(now).toHaveLength(old.length);
  const oldState: Modal = { x: 0, y: 0, feed: Number.NaN, power: 0, motion: 'G0' };
  const newState: Modal = { ...oldState };
  let inImage = false;
  let changed = 0;
  old.forEach((line, i) => {
    const next = now[i] ?? '';
    if (/^; image layer /.test(line)) inImage = true;
    else if (/^; (?:offset )?(?:fill )?layer /.test(line)) inImage = false;
    if (inImage) expect(next).toBe(line);
    expect(next.replace(FEED_WORD, '')).toBe(line.replace(FEED_WORD, ''));
    if (next !== line) changed += 1;
    const move = step(line, oldState);
    step(next, newState);
    if (move === null || Math.hypot(move.dx, move.dy) < 0.25) return;
    const surface = Math.hypot(move.dx, move.dy / k);
    const speed = (newState.feed * surface) / Math.hypot(move.dx, move.dy);
    expect(speed / oldState.feed).toBeGreaterThan(0.99);
    expect(speed / oldState.feed).toBeLessThan(1.01);
  });
  return changed;
}

describe('rotary projects saved by 1.0.30 (ADR-694 returning user)', () => {
  const cases = Object.keys(GOLDEN.projects).flatMap((name) =>
    Object.keys(PLACEMENTS).map((placement) => [name, placement] as const),
  );

  it('covers five setups and three placements', () => {
    expect(cases).toHaveLength(15);
  });

  it.each(cases)('%s with %s emits what 1.0.30 emitted, feeds matched', (name, placement) => {
    const project = opened(name);
    expect(project.device.rotary).not.toHaveProperty('taper');
    const before = program(project, PLACEMENTS[placement], false);
    expect(sha(before)).toBe(GOLDEN.gcodeSha256[`${name}/${placement}`]);
    const rotary = project.device.rotary;
    const k = isRotaryActive(rotary) ? rotaryYScale(rotary) : 1;
    const changed = expectOnlySurfaceMatchedFeeds(
      before,
      program(project, PLACEMENTS[placement]),
      k,
    );
    // ADR-127 Amd 2: the deliberate burn change reaches exactly the scaled rotaries.
    if (k === 1) expect(changed).toBe(0);
    else expect(changed).toBeGreaterThan(0);
  });

  it.each(Object.keys(GOLDEN.projects))('%s with the taper saved off emits the same', (name) => {
    const project = opened(name);
    const rotary = project.device.rotary;
    if (rotary === undefined) throw new Error('rotary missing');
    const taperOff: Project = {
      ...project,
      device: {
        ...project.device,
        rotary: {
          ...rotary,
          taper: {
            enabled: false,
            topDiameterMm: 80,
            bottomDiameterMm: 70,
            lengthMm: 100,
            topSide: 'left',
            artworkFromTopMm: 0,
          },
        },
      },
    };
    const placement = PLACEMENTS['current-position'];
    expect(sha(program(taperOff, placement, false))).toBe(
      GOLDEN.gcodeSha256[`${name}/current-position`],
    );
    expect(program(taperOff, placement)).toBe(program(project, placement));
  });
});

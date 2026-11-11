// A Moshiboard with a Y-port rotary (ADR-705 Amendment 1, rolling audit v14
// Z3-P1-2): every stroke must move the part's surface at the layer speed.
// The programs are decoded with the real decoder and the surface speed of each
// cut is measured from its decoded speed and machine direction.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { CutGroup, Job } from '../../job';
import { decodeMoshiProgram, type MoshiDecodedProgram } from './moshi-decoder';
import { encodeMoshiJob } from './moshi-job-encoder';
import { MM_PER_MIL } from './moshi-units';

const MOSHI = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' as const };
const LAYER_MM_S = 25; // 1500 mm/min

// Machine-space strokes: along X, round the part (machine Y = k x surface),
// and diagonal, each 20 mm of surface.
function rotaryJob(k: number): Job {
  const line: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#f00',
    power: 50,
    speed: LAYER_MM_S * 60,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
        closed: false,
      },
      {
        polyline: [
          { x: 40, y: 10 },
          { x: 40, y: 10 + 20 * k },
        ],
        closed: false,
      },
      {
        polyline: [
          { x: 50, y: 10 },
          { x: 50 + 14.142, y: 10 + 14.142 * k },
        ],
        closed: false,
      },
    ],
  };
  return { groups: [line], rotarySurfaceYScale: k };
}

function decodedPrograms(job: Job): MoshiDecodedProgram[] {
  const encoded = encodeMoshiJob(job, MOSHI);
  if (!encoded.ok) throw new Error(encoded.error.kind);
  return encoded.programs.map((program) => {
    const decoded = decodeMoshiProgram(program.bytes);
    if (!decoded.ok) throw new Error(decoded.error);
    return decoded.program;
  });
}

/** The share of the set dose each cut gets: layer speed / surface speed. */
function cutDoses(programs: ReadonlyArray<MoshiDecodedProgram>, k: number): number[] {
  const doses: number[] = [];
  for (const program of programs) {
    let at = program.steps[0];
    for (const step of program.steps.slice(1)) {
      if (step.cut && at !== undefined) {
        const dx = (step.x - at.x) * MM_PER_MIL;
        const dy = (step.y - at.y) * MM_PER_MIL;
        const surfaceShare = Math.hypot(dx, dy / k) / Math.hypot(dx, dy);
        doses.push(LAYER_MM_S / (program.speed * surfaceShare));
      }
      at = step;
    }
  }
  return doses;
}

describe('Moshi rotary surface speed', () => {
  for (const [name, k] of [
    ['Creality chuck, Ø80 (k 0.159)', 40 / (Math.PI * 80)],
    ['geared roller 150/Ø26, Ø80 (k 1.84)', 150 / (Math.PI * 26)],
  ] as const) {
    it(`burns every stroke near the set dose: ${name}`, () => {
      const programs = decodedPrograms(rotaryJob(k));
      const doses = cutDoses(programs, k);
      expect(doses).toHaveLength(3);
      // Whole mm/s quantises the match: within 13 % at the chuck's 4 mm/s
      // round the part, within 2 % elsewhere; before the fix 15.9 % / 184 %.
      for (const dose of doses) expect(Math.abs(dose - 1)).toBeLessThan(0.13);
      expect(programs.every((program) => program.mode === 'vector')).toBe(true);
      expect(programs.length).toBeGreaterThan(1);
    });
  }

  it('reports the runs, and the dose range once whole mm/s bites', () => {
    const k = 40 / (Math.PI * 80);
    const fast = encodeMoshiJob(rotaryJob(k), MOSHI);
    if (!fast.ok) throw new Error(fast.error.kind);
    expect(fast.notes.some((note) => note.includes('one per surface speed'))).toBe(true);
    // 25 mm/s: round the part 3.98 → 4 mm/s, within 1 %: no dose note.
    expect(fast.notes.some((note) => note.includes('of the set dose'))).toBe(false);
    // 5 mm/s: round the part 0.8 mm/s, held at the 1 mm/s floor: 80 %.
    const slow = rotaryJob(k);
    const group = slow.groups[0] as CutGroup;
    const encoded = encodeMoshiJob({ ...slow, groups: [{ ...group, speed: 300 }] }, MOSHI);
    if (!encoded.ok) throw new Error(encoded.error.kind);
    expect(encoded.notes.find((note) => note.includes('of the set dose'))).toContain(
      'between 80 % and 100 %',
    );
  });

  it('leaves a flat-bed job as one program at the layer speed', () => {
    const flat = { groups: rotaryJob(1).groups };
    const programs = decodedPrograms(flat);
    expect(programs).toHaveLength(1);
    expect(programs[0]?.speed).toBe(LAYER_MM_S);
  });
});

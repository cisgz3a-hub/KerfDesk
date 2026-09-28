// Local wide ink in a mixed-width stroke (ADR-454). A branch median cannot
// classify a short thick end or island on an otherwise thin pen line.
// Clean normal measurements provide the evidence, keeping junction gaps
// separate. Both the tolerance and support window follow the width gate, so
// an equivalent finer source or commit grid uses the same physical evidence.

import type { Vec2 } from '../../scene';
import {
  STROKE_WIDTH_SAMPLE_STEP_PX,
  type MeasuredCrossSection,
  type StrokeWidthProfile,
} from './stroke-width';

// At the default 4 px gate these are the existing 0.25 px width allowance
// and 6 px averaging window. A seed needs three quarters of that window to
// be measurably wide; a three-pixel, one-pixel-high pen blot is not enough.
const WIDTH_ALLOWANCE = 1 / 16;
const SUPPORT_GATE_WIDTHS = 1.5;
const SEED_SUPPORT_FRACTION = 0.75;
// A slanted pen can alternate either side of the threshold at every pixel.
// A wide mean sustained for two gate widths is independent evidence even
// when fewer than three quarters of the individual samples exceed it.
const SUSTAINED_GATE_WIDTHS = 2;
// Two wide runs on one stroke join when every window between them keeps its
// mean above this width, an eighth of the gate under it (3.5 px at a 4 px
// gate). A hand-drawn line wobbling around the gate then stays one fill
// instead of alternating fill and stroke with a double burn at every join
// (ADR-454 Amendment 3). Clearly thinner ink between them still separates
// them, and a near-gate end beyond the last wide run stays a stroke.
const BRIDGE_ALLOWANCE = 1 / 8;

/** Separate supported runs; never join them across clearly thinner ink or a junction. */
export function wideStrokeRuns(
  profile: StrokeWidthProfile | null,
  maxWidthPx: number,
  closed = false,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  if (profile === null) return [];
  const window = Math.max(
    2,
    Math.ceil((maxWidthPx * SUPPORT_GATE_WIDTHS) / STROKE_WIDTH_SAMPLE_STEP_PX),
  );
  const threshold = maxWidthPx * (1 + WIDTH_ALLOWANCE);
  const bridge = maxWidthPx * (1 - BRIDGE_ALLOWANCE);
  const sustained = Math.ceil((maxWidthPx * SUSTAINED_GATE_WIDTHS) / STROKE_WIDTH_SAMPLE_STEP_PX);
  const out: Vec2[][] = [];
  let clean: MeasuredCrossSection[] = [];
  const start = closed ? closedRunStart(profile.measurements) : 0;
  for (let i = 0; i <= profile.measurements.length; i += 1) {
    const section =
      i === profile.measurements.length
        ? null
        : (profile.measurements[(i + start) % profile.measurements.length] ?? null);
    if (section !== null) {
      clean.push(section);
      continue;
    }
    const gate = { window, threshold, bridge, sustained };
    for (const run of supportedRuns(clean, gate)) out.push(run);
    clean = [];
  }
  return out;
}

// The first point of a closed curve is arbitrary. Start after a genuine
// evidence gap, or at its narrowest cross-section, so a wide island cannot
// lose its support merely because it spans that seam.
function closedRunStart(sections: ReadonlyArray<MeasuredCrossSection | null>): number {
  let start = 0;
  let narrowest = Infinity;
  for (const [i, section] of sections.entries()) {
    if (section === null) return (i + 1) % sections.length;
    if (section.widthPx < narrowest) {
      narrowest = section.widthPx;
      start = i;
    }
  }
  return start;
}

type RunGate = {
  readonly window: number;
  readonly threshold: number;
  readonly bridge: number;
  readonly sustained: number;
};

// Width hysteresis: a well-supported window seeds a run; neighbouring
// windows whose mean remains wide extend it. A run seeded or sustained for
// two gate widths is kept, and joins the previous kept run when no window
// between them fell to the bridge width. Rolling sums make this linear in
// the number of measurements, independent of the gate/window size.
function supportedRuns(sections: ReadonlyArray<MeasuredCrossSection>, gate: RunGate): Vec2[][] {
  const { window, threshold, bridge, sustained } = gate;
  const out: Vec2[][] = [];
  let run: Vec2[] = [];
  let seeded = false;
  let kept: Vec2[] | null = null;
  let between: Vec2[] = [];
  let sum = 0;
  let above = 0;
  const closeRun = (): void => {
    if (seeded || run.length >= sustained) {
      if (kept === null) kept = run;
      else kept.push(...between, ...run);
      between = [];
    } else {
      between.push(...run);
    }
    run = [];
    seeded = false;
  };
  const closeBridge = (): void => {
    if (kept !== null) out.push(kept);
    kept = null;
    between = [];
  };
  for (let i = 0; i < sections.length; i += 1) {
    const current = sections[i] as MeasuredCrossSection;
    sum += current.widthPx;
    if (current.widthPx > threshold) above += 1;
    const previous = sections[i - window];
    if (previous !== undefined) {
      sum -= previous.widthPx;
      if (previous.widthPx > threshold) above -= 1;
    }
    if (i + 1 < window) continue;
    const mean = sum / window;
    if (mean <= threshold) {
      closeRun();
      if (mean <= bridge) closeBridge();
      else between.push((sections[i - Math.floor((window - 1) / 2)] as MeasuredCrossSection).p);
      continue;
    }
    appendWideWindow(run, sections, i, window, above);
    if (above >= Math.ceil(window * SEED_SUPPORT_FRACTION)) seeded = true;
  }
  closeRun();
  closeBridge();
  return out;
}

// The averaging window proves the whole edge window wide when every
// measurement exceeds the allowance. Keep its measured endpoints too:
// otherwise a bend's evidence gap loses another half-window on each
// side and a uniformly wide ring acquires artificial corner strokes.
// This does not cross a gap or extend into a measured thin transition.
function appendWideWindow(
  run: Vec2[],
  sections: ReadonlyArray<MeasuredCrossSection>,
  index: number,
  window: number,
  above: number,
): void {
  const halfWindow = Math.floor((window - 1) / 2);
  const centre = index - halfWindow;
  if (index === window - 1 && above === window) {
    for (let j = 0; j < centre; j += 1) run.push((sections[j] as MeasuredCrossSection).p);
  }
  run.push((sections[centre] as MeasuredCrossSection).p);
  if (index === sections.length - 1 && above === window) {
    for (let j = sections.length - halfWindow; j < sections.length; j += 1)
      run.push((sections[j] as MeasuredCrossSection).p);
  }
}

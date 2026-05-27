// Invariant predicates over emitted G-code strings.
//
// These back the property tests in Phase A acceptance (PROJECT.md "Vertical
// slice — Phase A acceptance"). They walk the G-code line-by-line and return
// `Issue`s rather than throwing — the caller decides whether a non-empty list
// is a test failure, a preflight modal, or both.
//
// Predicates accept any G-code string and are deliberately liberal about
// formatting: comments stripped, blank lines skipped, trailing-whitespace
// tolerated. This means they can validate G-code from external tools too, not
// just GrblStrategy's output.

export type Issue = {
  readonly lineNumber: number;
  readonly line: string;
  readonly reason: string;
};

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const X_RE = new RegExp(String.raw`\bX${NUM}`);
const Y_RE = new RegExp(String.raw`\bY${NUM}`);
const S_RE = new RegExp(String.raw`\bS${NUM}`);

function parseValue(line: string, re: RegExp): number | null {
  const m = re.exec(line);
  if (!m || m[1] === undefined) return null;
  return Number.parseFloat(m[1]);
}

function stripComment(line: string): string {
  const semi = line.indexOf(';');
  const head = semi >= 0 ? line.slice(0, semi) : line;
  return head.trim();
}

// PROJECT.md non-negotiable #3 — Laser-off on travel.
// A `G0` is safe if any of:
//   (a) `S0` is on the same line,
//   (b) the most recent non-comment line was `M5`,
//   (c) the most recent S value seen is 0 (sticky firmware state).
export function findLaserOnTravelIssues(gcode: string): readonly Issue[] {
  const lines = gcode.split('\n');
  const issues: Issue[] = [];
  let lastEffective = '';
  let stickyS: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripComment(raw);
    if (stripped === '') continue;
    const sVal = parseValue(stripped, S_RE);
    if (sVal !== null) stickyS = sVal;
    if (/^G0\b/.test(stripped)) {
      const okInline = sVal === 0;
      const okPriorM5 = /^M5\b/.test(lastEffective);
      const okSticky = stickyS === 0;
      if (!okInline && !okPriorM5 && !okSticky) {
        issues.push({
          lineNumber: i + 1,
          line: raw,
          reason: 'G0 without S0 and no preceding M5 / sticky S0',
        });
      }
    }
    lastEffective = stripped;
  }
  return issues;
}

// PROJECT.md non-negotiable #1 — Bounds check.
// Every X / Y emitted by a motion command (G0/G1/G2/G3) must fall inside the
// rectangle [0, width] × [0, height], in machine coordinates.
export function findOutOfBoundsCoords(
  gcode: string,
  bed: { readonly width: number; readonly height: number },
): readonly Issue[] {
  const lines = gcode.split('\n');
  const issues: Issue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripComment(raw);
    if (!/^G[0123]\b/.test(stripped)) continue;
    const x = parseValue(stripped, X_RE);
    const y = parseValue(stripped, Y_RE);
    if (x !== null && (x < 0 || x > bed.width)) {
      issues.push({ lineNumber: i + 1, line: raw, reason: `X out of bed: ${x}` });
    }
    if (y !== null && (y < 0 || y > bed.height)) {
      issues.push({ lineNumber: i + 1, line: raw, reason: `Y out of bed: ${y}` });
    }
  }
  return issues;
}

// PROJECT.md non-negotiable #7 — Power scale honest.
// The expected S value for a given power percentage and the device's
// $30 max power scale, rounded to the nearest integer.
export function expectedS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

// Collect every S value that appears on a G1 motion line.
export function collectG1SValues(gcode: string): readonly number[] {
  const lines = gcode.split('\n');
  const out: number[] = [];
  for (const raw of lines) {
    const stripped = stripComment(raw);
    if (!/^G1\b/.test(stripped)) continue;
    const s = parseValue(stripped, S_RE);
    if (s !== null) out.push(s);
  }
  return out;
}

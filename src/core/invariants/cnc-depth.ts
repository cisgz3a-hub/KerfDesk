// CNC depth invariant — "never cut below the stock", the depth analog of the
// bounds check (PROJECT non-negotiable #1, extended by ADR-094).
//
// Scans emitted G-code and flags any motion line (G0 or G1) whose Z target is
// below -(stock thickness + through-cut allowance). Preflight already rejects
// over-deep *settings*; this check proves the invariant on the final text so
// a regression anywhere upstream (depth expansion, ramps, relief passes,
// imported toolpaths) still blocks the file write.

export type CncDepthIssue = {
  readonly lineNumber: number; // 1-based
  readonly reason: string;
};

const Z_EPS = 1e-6;

// Matches cnc-preflight's through-cut allowance: cutting 1 mm into the
// spoilboard is normal practice; anything deeper is a compile bug.
export const DEFAULT_THROUGH_CUT_ALLOWANCE_MM = 1;

export function findOverdeepCutIssues(
  gcode: string,
  options: { readonly stockThicknessMm: number; readonly allowanceMm?: number },
): ReadonlyArray<CncDepthIssue> {
  const allowance = options.allowanceMm ?? DEFAULT_THROUGH_CUT_ALLOWANCE_MM;
  const floorZ = -(Math.max(0, options.stockThicknessMm) + Math.max(0, allowance));
  const issues: CncDepthIssue[] = [];
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const stripped = stripComment(lines[i] ?? '');
    if (stripped.length === 0) continue;
    if (!/^G[01]\b/.test(stripped)) continue;
    const z = parseAxis(stripped, 'Z');
    if (z === null) continue;
    if (z < floorZ - Z_EPS) {
      issues.push({
        lineNumber: i + 1,
        reason:
          `Z${z.toFixed(3)} cuts below the stock floor ${floorZ.toFixed(3)} mm ` +
          `(stock ${options.stockThicknessMm.toFixed(3)} mm + allowance ${allowance.toFixed(3)} mm).`,
      });
    }
  }
  return issues;
}

function stripComment(line: string): string {
  const semicolon = line.indexOf(';');
  const noSemi = semicolon === -1 ? line : line.slice(0, semicolon);
  return noSemi.replace(/\([^)]*\)/g, '').trim();
}

function parseAxis(line: string, axis: 'X' | 'Y' | 'Z'): number | null {
  const match = new RegExp(String.raw`\b${axis}(-?\d+(?:\.\d+)?)`).exec(line);
  return match?.[1] === undefined ? null : Number.parseFloat(match[1]);
}

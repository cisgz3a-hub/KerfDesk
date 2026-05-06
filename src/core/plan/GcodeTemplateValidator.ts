/**
 * T2-5: gcode template validator. Pre-T2-5 the four template
 * surfaces (`customStartGcode`, `customEndGcode`, `gcodeHeader
 * Template`, `gcodeFooterTemplate`) were concatenated directly into
 * the emitted stream; preflight saw the plan, not the templates. A
 * template like `M3 S1000\nG91\nG0 X500` could fire the laser in a
 * confused parser mode and move outside the validated bounds.
 *
 * T2-5 ships the rule engine + a minimal token-level parser
 * sufficient for the bounds check + per-rule TypedTemplateIssue. It
 * does NOT yet replace the existing T2-14 baseline-safety wrapper —
 * that remains the structural guarantee. T2-5 layers ABOVE: it
 * surfaces actionable diagnostics so the user sees "M3 with no S0 in
 * footer at line 5" rather than just "the safety wrapper had to add
 * an M5". Wiring this validator into the preflight UI + the
 * customStartGcode setter is filed as T2-5-followup.
 */

import type { AABB } from '../types';
import type { DeviceProfile } from '../devices/DeviceProfile';

export type ControllerId = 'grbl' | 'marlin' | 'unknown';

/** Severity affects whether the validator surfaces an error or a warning. */
export type TemplateIssueSeverity = 'error' | 'warning';

export type TemplateIssueKind =
  | 'unsafe-laser-on'
  | 'unmanaged-relative-mode'
  | 'g92-coordinate-reset'
  | 'system-command'
  | 'g53-machine-coords'
  | 'g28-go-home'
  | 'standalone-feed-setter'
  | 'standalone-spindle-setter'
  | 'controller-mismatch'
  | 'bounds-violation'
  | 'footer-leaves-laser-on'
  | 'footer-leaves-relative-mode'
  | 'invalid-syntax';

export interface TemplateIssue {
  kind: TemplateIssueKind;
  severity: TemplateIssueSeverity;
  /** 1-based source line that triggered the issue. */
  line: number;
  /** Original line text with comments stripped. */
  source: string;
  message: string;
}

export interface TemplateValidationContext {
  profile: DeviceProfile | null;
  controllerType: ControllerId;
  /**
   * Bounds the planned job is allowed to occupy. Templates that
   * emit absolute G0/G1 with X/Y outside this AABB are flagged.
   * Pass null when no plan-bounds are available (e.g. validating
   * a stand-alone snippet outside a job context).
   */
  machinePlanBounds: AABB | null;
  /** True when validating a footer template (different rules apply). */
  isFooter: boolean;
  /**
   * When true, "advanced" content that is otherwise blocked is only
   * surfaced as a warning. The user has explicitly opted in for
   * this ticket. Defaults to false.
   */
  allowAdvanced: boolean;
}

export interface TemplateValidationResult {
  issues: TemplateIssue[];
  /** Convenience — true when no `error`-severity issues. */
  ok: boolean;
}

const COMMENT_LINE_RE = /;.*$/;
const PARENS_COMMENT_RE = /\([^)]*\)/g;

/**
 * Strip comments from a single line. `;` to end-of-line and
 * parenthesised groups are both supported.
 */
export function stripComments(line: string): string {
  return line.replace(PARENS_COMMENT_RE, '').replace(COMMENT_LINE_RE, '').trim();
}

/**
 * Extract a token's numeric value from a gcode line, e.g. `extract
 * Number('S', 'M3 S1000')` → 1000. Returns null when the token is
 * absent or non-numeric.
 */
export function extractNumber(letter: string, line: string): number | null {
  const m = new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d+)?)`, 'i').exec(line);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Match a leading gcode word — a `G`/`M`/`T` followed by a number,
 * or a `$` system command. Returns null for plain words like "blah"
 * which the caller surfaces as `invalid-syntax`. Single-letter axis
 * words (`F3000`, `S100`) standalone on a line are recognised too —
 * the standalone-setter rule catches those.
 */
function leadingWord(line: string): string | null {
  const m = /^(\$[A-Z0-9#$]+|\$\$|[GMT][0-9]+(?:\.[0-9]+)?|[FSPXYZIJK]-?[0-9]+(?:\.[0-9]+)?)/i.exec(line);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Pure rule check — no I/O. Walks the template line by line,
 * accumulating modal state (G90/G91 + last X/Y in absolute mode),
 * and emits issues per rule. Tracks last-seen mode at end-of-template
 * for footer-hygiene checks.
 */
export function validateGcodeTemplate(
  template: string,
  context: TemplateValidationContext,
): TemplateValidationResult {
  const issues: TemplateIssue[] = [];
  const lines = template.split(/\r?\n/);

  let mode: 'absolute' | 'relative' | null = null;
  let laserOn = false;
  let lastFinalLine: string | null = null;

  const emit = (
    kind: TemplateIssueKind,
    severity: TemplateIssueSeverity,
    line: number,
    source: string,
    message: string,
  ): void => {
    // When advanced is allowed, downgrade what would be 'error'
    // structural blocks to 'warning' so the user can ship anyway.
    if (context.allowAdvanced && severity === 'error'
        && kind !== 'invalid-syntax'
        && kind !== 'bounds-violation'
        && kind !== 'controller-mismatch') {
      severity = 'warning';
    }
    issues.push({ kind, severity, line, source, message });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = stripComments(raw);
    if (stripped === '') continue;
    lastFinalLine = stripped;

    // Detect basic syntax problems first
    const word = leadingWord(stripped);
    if (!word) {
      emit('invalid-syntax', 'error', i + 1, stripped,
        `Line does not start with a recognised G/M/$ word.`);
      continue;
    }

    // ── Block-by-default rules ───────────────────────────────

    // M3 / M4 with no S0 ⇒ laser fires at last-known power
    if (word === 'M3' || word === 'M4') {
      const s = extractNumber('S', stripped);
      if (s == null || s !== 0) {
        emit('unsafe-laser-on', 'error', i + 1, stripped,
          `${word} starts the laser. Templates must use M3/M4 only with S0; `
          + `move S setting and laser-on into the plan, not the template.`);
      }
      laserOn = laserOn || (s != null && s > 0);
    }

    if (word === 'G91') {
      if (!context.isFooter) {
        emit('unmanaged-relative-mode', 'error', i + 1, stripped,
          `G91 (relative mode) in a header template conflicts with `
          + `LaserForge's mode management. Use the body of a job or set `
          + `the relative-return option instead.`);
      }
      mode = 'relative';
    }
    if (word === 'G90') {
      mode = 'absolute';
    }

    if (word === 'G92') {
      emit('g92-coordinate-reset', 'error', i + 1, stripped,
        `G92 resets the coordinate system; LaserForge does not allow this `
        + `inside templates because it invalidates the plan-bounds check.`);
    }

    if (word.startsWith('$')) {
      emit('system-command', 'error', i + 1, stripped,
        `System commands ('${word}') in templates are blocked; they alter `
        + `controller settings outside LaserForge's snapshot (T2-110).`);
    }

    if (word === 'G53') {
      emit('g53-machine-coords', 'error', i + 1, stripped,
        `G53 forces machine coordinates and bypasses WCS — disallowed in `
        + `templates because plan bounds are computed in WCS.`);
    }

    if (word === 'G28' || word === 'G28.1') {
      emit('g28-go-home', 'error', i + 1, stripped,
        `${word} (go-home) in templates is blocked; user homing is owned `
        + `by LaserForge's homing flow.`);
    }

    // Standalone F or S setter (no motion or laser-on with it)
    if (/^F\d/.test(stripped)) {
      emit('standalone-feed-setter', 'warning', i + 1, stripped,
        `Standalone F setter has no effect outside a motion block — likely a typo.`);
    }
    if (/^S\d/.test(stripped)) {
      emit('standalone-spindle-setter', 'warning', i + 1, stripped,
        `Standalone S setter has no effect outside a laser-on; remove or pair with M3/M4.`);
    }

    // ── Controller-mismatch rules ─────────────────────────────

    if (context.controllerType === 'grbl' && word === 'M300') {
      emit('controller-mismatch', 'error', i + 1, stripped,
        `M300 (beep) is unsupported on GRBL.`);
    }
    if (word === '$H' && context.profile?.homingEnabled === false) {
      emit('controller-mismatch', 'error', i + 1, stripped,
        `$H requires homing — current profile has homing disabled ($22=0).`);
    }

    // ── Bounds rule ───────────────────────────────────────────

    if ((word === 'G0' || word === 'G1') && mode !== 'relative'
        && context.machinePlanBounds) {
      const x = extractNumber('X', stripped);
      const y = extractNumber('Y', stripped);
      const b = context.machinePlanBounds;
      if (x != null && (x < b.minX || x > b.maxX)) {
        emit('bounds-violation', 'error', i + 1, stripped,
          `Absolute move X=${x} is outside plan bounds [${b.minX}, ${b.maxX}].`);
      }
      if (y != null && (y < b.minY || y > b.maxY)) {
        emit('bounds-violation', 'error', i + 1, stripped,
          `Absolute move Y=${y} is outside plan bounds [${b.minY}, ${b.maxY}].`);
      }
    }

    if (word === 'M5') {
      laserOn = false;
    }
  }

  // ── Footer hygiene rules ─────────────────────────────────────

  if (context.isFooter) {
    if (laserOn) {
      emit('footer-leaves-laser-on', 'error', lines.length, lastFinalLine ?? '',
        `Footer template ends with the laser commanded ON; emit M5 before the final line.`);
    }
    if (mode === 'relative') {
      emit('footer-leaves-relative-mode', 'error', lines.length, lastFinalLine ?? '',
        `Footer template ends in G91 (relative mode); emit G90 before the final line.`);
    }
  }

  const ok = issues.every((iss) => iss.severity !== 'error');
  return { issues, ok };
}

/**
 * FNV-1a hash of the template text. Stable identifier for the
 * "advanced user-authored" opt-in stored alongside the
 * ValidatedJobTicket — the user opts in for THIS template hash;
 * any edit invalidates the opt-in.
 */
export function hashTemplate(template: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < template.length; i++) {
    hash ^= template.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (template.charCodeAt(i) >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

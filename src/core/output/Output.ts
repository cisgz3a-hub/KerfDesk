/**
 * === FILE: /src/core/output/Output.ts ===
 * 
 * Purpose:    The Output is Stage 3 of the pipeline: Plan → Output.
 *             An Output is a DEVICE-SPECIFIC representation of the plan.
 *             Could be G-code text, Ruida binary, or any other format.
 *             This is the final stage before sending to hardware.
 * 
 * Pipeline:   Plan → [generateOutput()] → Output → [controller.sendJob()] → Machine
 * 
 * Dependencies: /src/core/types.ts
 * Last updated: Phase 5, Step 18 — Plan Optimizer (added laserOn/laserOff encoding)
 */

import { generateId } from '../types';
import type { OutputFormat } from './OutputFormat';

// ─── OUTPUT FORMAT ───────────────────────────────────────────────

export type { OutputFormat } from './OutputFormat';

// ─── OUTPUT ──────────────────────────────────────────────────────

export interface Output {
  readonly id: string;
  planId: string;
  format: OutputFormat;
  createdAt: string;

  // Text-based formats (G-code)
  text: string | null;
  lineCount: number;

  // Binary formats (Ruida)
  binary: Uint8Array | null;

  fileSizeBytes: number;
}

// ─── OUTPUT STRATEGY INTERFACE ───────────────────────────────────
/**
 * Strategy pattern for device-specific output generation.
 * Each machine protocol implements this interface.
 * The Plan → Output conversion is delegated to the strategy.
 */

import {
  countPlannedOperationMoves,
  iteratePlannedOperationMoves,
  totalMoveCount,
  type Plan,
  type Move,
} from '../plan/Plan';
import { type Job } from '../job/Job';
import { type AirAssistCommand, type GcodeGenerateOptions, type GrblLaserPowerMode } from './GcodeOrigin';
import {
  type GcodeChunk,
  type GcodeGenerateOptions as StreamingChunkOptions,
} from './GcodeStreaming';
import { emptyTemplateContext, renderTemplate } from '../plan/GcodeTemplates';
import { validateGcodeTemplates, type TemplateFinding } from '../preflight/GcodeTemplateValidator';

export type { GcodeGenerateOptions, GcodeStartMode } from './GcodeOrigin';

export type StreamingGcodeGenerateOptions = GcodeGenerateOptions & StreamingChunkOptions;

export interface OutputStrategy {
  readonly formatId: OutputFormat;
  readonly formatName: string;
  /**
   * Whether the target firmware already compensates laser power during
   * accel/decel (for example GRBL M4 dynamic mode). When true, software-side
   * acceleration-aware power splitting must be disabled to avoid double
   * attenuation.
   */
  readonly supportsDynamicLaserPower: boolean;

  // Generate full output from a plan
  generate(plan: Plan, job: Job, options?: GcodeGenerateOptions): Output;
  generateGcode?(plan: Plan, job: Job, options?: StreamingGcodeGenerateOptions): AsyncIterable<GcodeChunk>;

  // Individual move encoding (used by generate internally)
  encodeHeader(job: Job, options?: GcodeGenerateOptions): string;
  encodeRapid(to: { x: number; y: number }): string;
  encodeLinear(to: { x: number; y: number }, power: number, speed: number): string;
  encodeLaserOn(power: number): string;
  encodeLaserOff(): string;
  encodeDwell(ms: number): string;
  encodeAirAssist(on: boolean): string;
  encodeZMove(z: number): string;
  encodeFooter(job: Job, options?: GcodeGenerateOptions): string;
}

/**
 * Thrown when one or more user g-code template findings have
 * severity 'error'. Pre-T1-168 this carried a single `finding` —
 * `validateTemplatesBeforeEmission` threw on the first error and
 * discarded any remaining error-severity findings AND every warning-
 * severity finding entirely. A user template with 3 errors had to
 * be fixed one-at-a-time across 3 compile roundtrips. The full-code
 * audit (docs/AUDIT-2026-05-11.md F-025) flagged this as a UX gap.
 *
 * T1-168 (audit F-025): the error now aggregates every error-severity
 * finding into `errors` so the UI can render the full list in one
 * roundtrip, and exposes the warning-severity findings via `warnings`
 * so they're not silently dropped. `finding` is kept as a backwards-
 * compat alias for `errors[0]` so existing callsites (`error.finding`
 * reads) continue to work — the only callsite today is the constructor
 * itself, but the field is a documented part of the public surface.
 *
 * The message is built from every error-severity finding so the
 * default `error.message` string remains useful in logs without a
 * caller having to walk `errors[]`. Format: first error verbatim,
 * then "(+N more errors)" if `errors.length > 1`.
 */
export class TemplateValidationError extends Error {
  /** First error-severity finding (backwards-compat alias for `errors[0]`). */
  readonly finding: TemplateFinding;
  /** All error-severity findings, in source order. Always at least one. */
  readonly errors: readonly TemplateFinding[];
  /** Warning-severity findings collected during the same validation pass. */
  readonly warnings: readonly TemplateFinding[];

  constructor(errors: readonly TemplateFinding[], warnings: readonly TemplateFinding[] = []) {
    if (errors.length === 0) {
      // Defensive — callers should only build this when there is at
      // least one error finding. Throwing the wrong type here would
      // mask a real bug at the construction site.
      throw new Error('TemplateValidationError requires at least one error-severity finding.');
    }
    const head = errors[0];
    const summary = errors.length === 1
      ? `Template validation failed (${head.code}): ${head.message}`
      : `Template validation failed (${head.code}): ${head.message} (+${errors.length - 1} more error${errors.length - 1 === 1 ? '' : 's'})`;
    super(summary);
    this.name = 'TemplateValidationError';
    this.finding = head;
    this.errors = errors;
    this.warnings = warnings;
  }
}

function throwIfOutputAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Compile cancelled', 'AbortError');
  }
}

function countPlanMoves(plan: Plan): number {
  return plan.stats.moveCount > 0 ? plan.stats.moveCount : totalMoveCount(plan);
}

function reportOutputProgress(
  options: GcodeGenerateOptions | undefined,
  event: Parameters<NonNullable<GcodeGenerateOptions['onProgress']>>[0],
): void {
  if (!options?.onProgress) return;
  const total = Math.max(1, event.totalMoves);
  const fraction = Math.max(0, Math.min(1, event.completedMoves / total));
  options.onProgress({ ...event, fraction });
}

// ─── STRATEGY REGISTRY ───────────────────────────────────────────

const strategies = new Map<OutputFormat, OutputStrategy>();

export function registerOutputStrategy(strategy: OutputStrategy): void {
  strategies.set(strategy.formatId, strategy);
}

export function getOutputStrategy(format: OutputFormat): OutputStrategy | undefined {
  return strategies.get(format);
}

export function listOutputFormats(): OutputFormat[] {
  return [...strategies.keys()];
}

// ─── BASE GCODE STRATEGY ─────────────────────────────────────────
/**
 * Base implementation for G-code based controllers.
 * GRBL and Marlin extend this with their specific differences.
 */
export abstract class BaseGCodeStrategy implements OutputStrategy {
  abstract readonly formatId: OutputFormat;
  abstract readonly formatName: string;
  abstract readonly supportsDynamicLaserPower: boolean;

  // Subclasses override these for protocol differences
  abstract encodeLaserOn(power: number): string;
  abstract encodeLaserOff(): string;
  abstract encodePowerValue(power: number): string;
  protected abstract encodePowerValueForMaxSpindle(power: number, maxSpindle: number): string;
  protected encodeLaserOnForMaxSpindle(
    power: number,
    maxSpindle: number,
    grblLaserPowerMode?: GrblLaserPowerMode,
  ): string {
    void maxSpindle;
    void grblLaserPowerMode;
    return this.encodeLaserOn(power);
  }

  private currentSpeed = 0;
  /** GRBL $30 / PWM ceiling; set each generate() from options.maxSpindle (default 1000). */
  protected _maxSpindle = 1000;

  /** Previous emitted move target in emitted coordinate space (absolute XY in plan). Used for G91 deltas. */
  private _prevPos: { x: number; y: number } = { x: 0, y: 0 };
  /** True while generating Head-mode (startMode=current) output — emit G91 relative XY/Z. */
  private _relative = false;
  /** Last emitted absolute Z (for relative Z deltas). */
  private _prevZ = 0;

  private static readonly _posEps = 0.0005;

  get format(): string {
    return this.formatId;
  }

  generate(plan: Plan, job: Job, options?: GcodeGenerateOptions): Output {
    const generatedAt = (options?.clock ?? (() => new Date().toISOString()))();
    const lines = Array.from(this.iterateGcodeLines(plan, job, options, generatedAt));
    const text = lines.filter(l => l !== undefined).join('\n');

    return {
      id: generateId(),
      planId: plan.id,
      format: this.formatId,
      createdAt: generatedAt,
      text,
      lineCount: lines.length,
      binary: null,
      fileSizeBytes: new TextEncoder().encode(text).length,
    };
  }

  async *generateGcode(
    plan: Plan,
    job: Job,
    options: StreamingGcodeGenerateOptions = {},
  ): AsyncGenerator<GcodeChunk, void, void> {
    const chunkLines = options.chunkLines ?? 1000;
    if (chunkLines <= 0) {
      throw new Error('generateGcode: chunkLines must be > 0');
    }

    const generatedAt = (options.clock ?? (() => new Date().toISOString()))();
    let cumulativeLineCount = 0;
    let pending: string[] = [];
    let ready: string[] | null = null;

    for (const line of this.iterateGcodeLines(plan, job, options, generatedAt)) {
      if (options.signal?.aborted) return;
      pending.push(line);

      if (pending.length >= chunkLines) {
        if (ready !== null) {
          cumulativeLineCount += ready.length;
          yield {
            lines: ready,
            cumulativeLineCount,
            isLast: false,
          };
        }
        ready = pending;
        pending = [];
      }
    }

    if (options.signal?.aborted) return;
    if (ready !== null) {
      if (pending.length > 0) {
        cumulativeLineCount += ready.length;
        yield {
          lines: ready,
          cumulativeLineCount,
          isLast: false,
        };
        cumulativeLineCount += pending.length;
        yield {
          lines: pending,
          cumulativeLineCount,
          isLast: true,
        };
      } else {
        cumulativeLineCount += ready.length;
        yield {
          lines: ready,
          cumulativeLineCount,
          isLast: true,
        };
      }
      return;
    }

    cumulativeLineCount += pending.length;
    yield {
      lines: pending,
      cumulativeLineCount,
      isLast: true,
    };
  }

  private *iterateGcodeLines(
    plan: Plan,
    job: Job,
    options: GcodeGenerateOptions | undefined,
    generatedAt: string,
  ): Generator<string, void, void> {
    throwIfOutputAborted(options?.signal);
    const state = this.createEncoderState(options);
    const totalMoves = countPlanMoves(plan);
    let completedMoves = 0;
    let emittedLines = 0;
    const tailNonEmpty: string[] = [];

    const rememberLine = (line: string): string => {
      emittedLines++;
      if (line.trim().length > 0) {
        tailNonEmpty.push(line);
        if (tailNonEmpty.length > 5) tailNonEmpty.shift();
      }
      return line;
    };

    try {
      validateTemplatesBeforeEmission(job, options, state.maxSpindle);
      throwIfOutputAborted(options?.signal);
      const header = this.encodeHeader(job, options, generatedAt);
      const headerLines = header.split(/\r?\n/);
      for (let i = 0; i < headerLines.length; i++) {
        yield rememberLine(headerLines[i]);
      }

      for (let operationIndex = 0; operationIndex < plan.operations.length; operationIndex++) {
        throwIfOutputAborted(options?.signal);
        const op = plan.operations[operationIndex];
        const srcOp = job.operations.find(o => o.id === op.operationId);
        const passes = Math.max(1, srcOp?.settings.passes ?? 1);
        yield rememberLine('');
        if (passes > 1) {
          yield rememberLine(`; --- ${op.layerName} (pass ${op.passIndex + 1}/${passes}) ---`);
        } else {
          yield rememberLine(`; --- ${op.layerName} (pass ${op.passIndex + 1}) ---`);
        }

        const opMoveCount = countPlannedOperationMoves(op, options?.signal);
        let moveIndex = 0;
        for (const move of iteratePlannedOperationMoves(op, options?.signal)) {
          throwIfOutputAborted(options?.signal);
          const encoded = this.encodeMoveWithState(move, state);
          for (const line of encoded.split(/\r?\n/)) {
            yield rememberLine(line);
          }
          completedMoves++;
          reportOutputProgress(options, {
            fraction: 0,
            completedMoves,
            totalMoves,
            operationIndex,
            operationCount: plan.operations.length,
            moveIndex,
            moveCount: opMoveCount,
            emittedLines,
            detail: `Emitted ${completedMoves}/${totalMoves} G-code moves`,
          });
          moveIndex++;
          throwIfOutputAborted(options?.signal);
        }
      }

      // Template footer path does not call encodeRapid for RETURN_X/Y — it emits
      // literal G0 X0 Y0 when returnPosition is (0,0), which is a no-op in G91.
      // Inject the true relative return here so the head returns to the pre-Job
      // position before the template block runs. Non-template footers already
      // append this inside encodeFooter(); skip when no template to avoid duplicating.
      if (state.relative && options?.gcodeFooterTemplate?.trim()) {
        throwIfOutputAborted(options?.signal);
        const backX = -state.prevPos.x;
        const backY = -state.prevPos.y;
        const eps = BaseGCodeStrategy._posEps;
        if (Math.abs(backX) > eps || Math.abs(backY) > eps) {
          yield rememberLine(`G0 X${backX.toFixed(3)} Y${backY.toFixed(3)} ; return to start`);
          state.prevPos = { x: 0, y: 0 };
        }
      }

      yield rememberLine('');
      throwIfOutputAborted(options?.signal);
      // T1-180 (external audit High #5): snapshot the encoder's
      // mutable modal state BEFORE the preview-pass encodeFooter
      // call. Pre-T1-180 encodeFooter was invoked twice — once to
      // count footer lines (so the second call could pass the real
      // `totalLines` to the footer template), then once to emit the
      // final footer. Both calls go through `encodeRapid` for the
      // return-to-origin move, which mutates `_prevPos` /
      // `currentSpeed`. The preview-pass mutation leaked into the
      // final-pass emission: if the footer template produced
      // different content based on `totalLines` (e.g. relative-mode
      // return distances), the final pass started from a state
      // already-mutated by the preview pass and could emit
      // inconsistent geometry. The audit flagged this as High
      // severity (output determinism).
      const stateSnapshot = {
        prevPos: { x: state.prevPos.x, y: state.prevPos.y },
        prevZ: state.prevZ,
        currentSpeed: state.currentSpeed,
        laserModalArmed: state.laserModalArmed,
      };
      const previewFooter = this.encodeFooterWithState(job, options, emittedLines + 1, state);
      const footerLineCount = previewFooter.length > 0 ? previewFooter.split(/\r?\n/).length : 0;
      const totalLines = emittedLines + footerLineCount;
      // Restore the snapshot so the final encodeFooter sees the same
      // state the operations loop left behind, not the preview-pass
      // residue. Output stays deterministic.
      state.prevPos = { x: stateSnapshot.prevPos.x, y: stateSnapshot.prevPos.y };
      state.prevZ = stateSnapshot.prevZ;
      state.currentSpeed = stateSnapshot.currentSpeed;
      state.laserModalArmed = stateSnapshot.laserModalArmed;
      const footer = this.encodeFooterWithState(job, options, totalLines, state);
      const footerLines = footer.split(/\r?\n/);
      for (let i = 0; i < footerLines.length; i++) {
        throwIfOutputAborted(options?.signal);
        yield rememberLine(footerLines[i]);
      }

      // T1-26: defense-in-depth laser-off at the final gcode boundary.
      // The strict FOOTER_MISSING_M5 validator blocks malformed custom
      // footers before job start, but this keeps every encoded artifact
      // safe even if a future path bypasses that validator.
      //
      // T1-167 (audit F-024): strip GRBL comments before the regex.
      // Pre-T1-167 the scan ran against the raw tail, so a user
      // template ending `; remember to send M5` (or `(M5 reminder)`)
      // would falsely match `\bM5\b` and skip the defense-in-depth
      // append — leaving the laser ON at job end if T2-14's footer
      // was also bypassed. Strip line-comments (`;` to EOL) AND
      // parenthesized comments (`(...)`) so only executable g-code
      // tokens reach the regex.
      const tailCodeOnly = tailNonEmpty
        .map(l => l.replace(/\([^)]*\)/g, '').replace(/;.*$/, ''))
        .join('\n');
      if (!/\bM5\b/i.test(tailCodeOnly)) {
        throwIfOutputAborted(options?.signal);
        yield rememberLine('M5 S0 ; T1-26 defense-in-depth laser-off');
      }

      throwIfOutputAborted(options?.signal);
    } finally {
      // Encoder state is per-run; no shared strategy fields are reset here.
    }
  }

  private createEncoderState(options?: GcodeGenerateOptions): GcodeEncoderState {
    return {
      currentSpeed: 0,
      hardOffZeroPowerLinearMoves: options?.hardOffZeroPowerLinearMoves ?? true,
      hardOffRapidMoves: options?.hardOffRapidMoves ?? true,
      maxSpindle: options?.maxSpindle ?? 1000,
      grblLaserPowerMode: options?.grblLaserPowerMode ?? 'dynamic-m4',
      airAssistCommand: options?.airAssistCommand ?? 'M8',
      prevPos: { x: 0, y: 0 },
      relative: options?.startMode === 'current',
      prevZ: 0,
      laserModalArmed: false,
    };
  }

  encodeHeader(job: Job, options?: GcodeGenerateOptions, generatedAt?: string): string {
    const useRelative = options?.startMode === 'current';
    const dateStamp = generatedAt ?? (options?.clock ?? (() => new Date().toISOString()))();
    const safeJobName = renderTemplate('{JOB_NAME}', {
      ...emptyTemplateContext(),
      jobName: job.name,
    });
    // T2-14: non-removable safety baseline. Pre-T2-14 a `gcodeHeaderTemplate`
    // REPLACED `defaultBlock` entirely — the template author was trusted to
    // include G21 + G90/G91 + M5. A template omitting any of those silently
    // produced unsafe job start (firmware default units could be inches;
    // distance mode could be left-over G91 from a prior job; feed mode /
    // active plane could carry over from hand-entered CNC commands; laser
    // modal state could be M3/M4 from a prior burn). Now the safety baseline is
    // emitted FIRST and is non-removable; template / customStart extras
    // append AFTER it. Duplicate G21/G90/M5 from older user templates is
    // idempotent and harmless. Adding new safety modals (e.g. T1-32 $32
    // verification) only requires updating this baseline, not auditing
    // every user template.
    const safetyHeader = [
      `; Generated by LaserForge`,
      `; Job: ${safeJobName}`,
      `; Date: ${dateStamp}`,
      `; Objects: ${job.metadata.objectCount}, Layers: ${job.metadata.layerCount}`,
      'G21 ; T2-14 safety baseline: mm mode',
      'G17 ; T3-20 safety baseline: XY plane',
      useRelative
        ? 'G91 ; T2-14 safety baseline: relative positioning (Head mode)'
        : 'G90 ; T2-14 safety baseline: absolute positioning',
      'G94 ; T3-20 safety baseline: feed per minute',
      `${this.encodeLaserOff()} ; T2-14 safety baseline: laser off at start`,
    ];

    const extras: string[] = [];
    if (options?.gcodeHeaderTemplate) {
      const rendered = renderTemplate(
        options.gcodeHeaderTemplate,
        options.gcodeTemplateContext ?? {
          ...emptyTemplateContext(),
          jobName: job.name || 'untitled',
        },
      );
      if (rendered.length > 0) {
        for (const line of rendered.split(/\r?\n/).map(l => l.trimEnd())) {
          extras.push(line);
        }
      }
      // T2-14: keep T1-43's relative-mode hint AFTER the template body
      // (only when no customStartGcode follows — customStart's own
      // reassertion below covers that path).
      if (useRelative && !options?.customStartGcode?.trim()) {
        extras.push('G91 ; LaserForge: Head mode requires relative positioning');
      }
    }

    const customStart = options?.customStartGcode?.trim();
    if (customStart) {
      const customLines = customStart.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
      for (const line of customLines) extras.push(line);
      // T1-43: reassert the correct positioning mode after the custom-start
      // block. If customStart contained G90 or G91, preflight should block
      // job start — this is runtime defense-in-depth for any bypass path.
      extras.push(useRelative
        ? 'G91 ; LaserForge: reassert relative mode after customStartGcode (T1-43)'
        : 'G90 ; LaserForge: reassert absolute mode after customStartGcode (T1-43)');
    }

    return [...safetyHeader, ...extras].join('\n');
  }

  encodeRapid(to: { x: number; y: number }): string {
    const eps = BaseGCodeStrategy._posEps;
    if (!this._relative) {
      this._prevPos = { x: to.x, y: to.y };
      return `G0 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`;
    }
    const dx = to.x - this._prevPos.x;
    const dy = to.y - this._prevPos.y;
    this._prevPos = { x: to.x, y: to.y };
    if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
      return '; G0 skipped (no motion)';
    }
    const parts: string[] = ['G0'];
    if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
    if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);
    return parts.join(' ');
  }

  encodeLinear(to: { x: number; y: number }, power: number, speed: number): string {
    const eps = BaseGCodeStrategy._posEps;
    // T1-180 (external audit High #5): suppress zero-distance G1
    // moves regardless of mode. Pre-T1-180 the absolute-mode branch
    // emitted `G1 X.. Y.. S<power>` even when (to.x, to.y) ===
    // _prevPos; the relative-mode branch built up an emission like
    // `G1 F<speed> S<power>` (no X/Y components). Both produce
    // **stationary** nonzero-power motion — the planner sits at one
    // point with the laser on at full power, which is a dwell-burn
    // and can scorch / through-cut material. The audit flagged this
    // as High severity. Post-T1-180 we return a documenting comment
    // so the line accounting (line count, byte count) still works
    // but no motion / power command reaches the firmware.
    const dx = to.x - this._prevPos.x;
    const dy = to.y - this._prevPos.y;
    if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
      return `; G1 skipped (zero distance — would dwell-burn at S${
        Math.max(0, Math.round((power / 100) * this._maxSpindle))
      } if emitted)`;
    }

    if (!this._relative) {
      this._prevPos = { x: to.x, y: to.y };
      const parts = [`G1 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`];
      if (speed !== this.currentSpeed) {
        parts.push(`F${speed.toFixed(0)}`);
        this.currentSpeed = speed;
      }
      parts.push(this.encodePowerValue(power));
      return parts.join(' ');
    }

    this._prevPos = { x: to.x, y: to.y };

    const parts: string[] = ['G1'];
    if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
    if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);

    if (speed !== this.currentSpeed) {
      parts.push(`F${speed.toFixed(0)}`);
      this.currentSpeed = speed;
    }
    parts.push(this.encodePowerValue(power));
    return parts.join(' ');
  }

  encodeDwell(ms: number): string {
    return `G4 P${(ms / 1000).toFixed(3)}`;
  }

  encodeAirAssist(on: boolean): string {
    return on ? 'M8 ; air assist ON' : 'M9 ; air assist OFF';
  }

  encodeZMove(z: number): string {
    const eps = BaseGCodeStrategy._posEps;
    if (!this._relative) {
      this._prevZ = z;
      return `G0 Z${z.toFixed(3)}`;
    }
    const dz = z - this._prevZ;
    this._prevZ = z;
    if (Math.abs(dz) < eps) return '; Z skipped (no motion)';
    return `G0 Z${dz.toFixed(3)}`;
  }

  encodeFooter(job: Job, options?: GcodeGenerateOptions, totalLines = 0): string {
    // T2-14: non-removable safety footer. Pre-T2-14 a `gcodeFooterTemplate`
    // could omit M5/M2 entirely; the template-author was trusted. Validator
    // (T2-5) catches the M5 omission, and T1-26 appends M5 at send time —
    // but the structural guarantee was missing. Now the safety footer (M5
    // + M2 + optional return-to-origin / G90 restore) is always emitted
    // last; template / customEnd extras come BEFORE it. Duplicate M5 / M2
    // from a template that already includes them is idempotent and harmless.

    const extras: string[] = [];
    const pre = options?.customEndGcode?.trim();
    if (pre) {
      for (const line of pre.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0)) {
        extras.push(line);
      }
    }
    if (options?.gcodeFooterTemplate) {
      const templateContext = {
        ...(options.gcodeTemplateContext ?? {
          ...emptyTemplateContext(),
          jobName: job.name || 'untitled',
        }),
        totalLines,
      };
      const renderedFooter = renderTemplate(options.gcodeFooterTemplate, templateContext);
      if (renderedFooter.trim().length > 0) {
        const footerParts = renderedFooter.split(/\r?\n/).map(l => l.trimEnd());
        for (let i = 0; i < footerParts.length; i++) {
          extras.push(footerParts[i]);
        }
      }
    }

    const safetyFooter: string[] = [];
    safetyFooter.push(`${this.encodeLaserOff()} ; T2-14 safety baseline: laser off at end`);
    if (this._relative) {
      const backX = -this._prevPos.x;
      const backY = -this._prevPos.y;
      const eps = BaseGCodeStrategy._posEps;
      if (Math.abs(backX) > eps || Math.abs(backY) > eps) {
        safetyFooter.push(`G0 X${backX.toFixed(3)} Y${backY.toFixed(3)} ; return to start`);
      }
      safetyFooter.push('G90 ; restore absolute positioning');
    } else {
      const rp = options?.returnPosition;
      if (
        rp != null &&
        Number.isFinite(rp.x) &&
        Number.isFinite(rp.y)
      ) {
        safetyFooter.push(`${this.encodeRapid(rp)} ; return to job origin`);
      }
    }
    safetyFooter.push('M2 ; T2-14 safety baseline: program end');

    return [...extras, ...safetyFooter].join('\n');
  }

  private encodeRapidWithState(to: { x: number; y: number }, state: GcodeEncoderState): string {
    const eps = BaseGCodeStrategy._posEps;
    let travelLine: string;
    if (!state.relative) {
      state.prevPos = { x: to.x, y: to.y };
      travelLine = `G0 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`;
    } else {
      const dx = to.x - state.prevPos.x;
      const dy = to.y - state.prevPos.y;
      state.prevPos = { x: to.x, y: to.y };
      if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
        return '; G0 skipped (no motion)';
      }
      const parts: string[] = ['G0'];
      if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
      if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);
      travelLine = parts.join(' ');
    }

    if (!state.hardOffRapidMoves || !state.laserModalArmed) {
      return travelLine;
    }

    // Defense-in-depth for real machines: GRBL $32=1 should suppress laser
    // output during G0, but a stale or wrong firmware setting can turn
    // modal M3/M4 rapids into visible travel burns.
    state.laserModalArmed = true;
    return [
      this.encodeLaserOff(),
      travelLine,
      this.encodeLaserOnForMaxSpindle(0, state.maxSpindle, state.grblLaserPowerMode),
    ].join('\n');
  }

  private encodeLinearWithState(
    to: { x: number; y: number },
    power: number,
    speed: number,
    state: GcodeEncoderState,
  ): string {
    const eps = BaseGCodeStrategy._posEps;
    const dx = to.x - state.prevPos.x;
    const dy = to.y - state.prevPos.y;
    if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
      return `; G1 skipped (zero distance — would dwell-burn at S${
        Math.max(0, Math.round((power / 100) * state.maxSpindle))
      } if emitted)`;
    }

    if (state.hardOffZeroPowerLinearMoves && power <= 0) {
      return this.encodeHardOffLinearTravelWithState(to, speed, state);
    }

    if (!state.relative) {
      state.prevPos = { x: to.x, y: to.y };
      const parts = [`G1 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`];
      if (speed !== state.currentSpeed) {
        parts.push(`F${speed.toFixed(0)}`);
        state.currentSpeed = speed;
      }
      parts.push(this.encodePowerValueForMaxSpindle(power, state.maxSpindle));
      return parts.join(' ');
    }

    state.prevPos = { x: to.x, y: to.y };

    const parts: string[] = ['G1'];
    if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
    if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);

    if (speed !== state.currentSpeed) {
      parts.push(`F${speed.toFixed(0)}`);
      state.currentSpeed = speed;
    }
    parts.push(this.encodePowerValueForMaxSpindle(power, state.maxSpindle));
    return parts.join(' ');
  }

  private encodeHardOffLinearTravelWithState(
    to: { x: number; y: number },
    speed: number,
    state: GcodeEncoderState,
  ): string {
    const eps = BaseGCodeStrategy._posEps;
    let travelLine: string;

    if (!state.relative) {
      state.prevPos = { x: to.x, y: to.y };
      const parts = [`G1 X${to.x.toFixed(3)} Y${to.y.toFixed(3)}`];
      if (speed !== state.currentSpeed) {
        parts.push(`F${speed.toFixed(0)}`);
        state.currentSpeed = speed;
      }
      travelLine = parts.join(' ');
    } else {
      const dx = to.x - state.prevPos.x;
      const dy = to.y - state.prevPos.y;
      state.prevPos = { x: to.x, y: to.y };
      const parts: string[] = ['G1'];
      if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
      if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);
      if (speed !== state.currentSpeed) {
        parts.push(`F${speed.toFixed(0)}`);
        state.currentSpeed = speed;
      }
      travelLine = parts.join(' ');
    }

    state.laserModalArmed = true;
    return [
      this.encodeLaserOff(),
      travelLine,
      this.encodeLaserOnForMaxSpindle(0, state.maxSpindle, state.grblLaserPowerMode),
    ].join('\n');
  }

  private encodeLaserOnWithState(power: number, state: GcodeEncoderState): string {
    state.laserModalArmed = true;
    return this.encodeLaserOnForMaxSpindle(power, state.maxSpindle, state.grblLaserPowerMode);
  }

  protected encodeAirAssistForCommand(on: boolean, command: AirAssistCommand): string {
    if (!on) return 'M9 ; air assist OFF';
    if (command === 'none') return '; air assist ON skipped (profile command none)';
    return `${command} ; air assist ON`;
  }

  private encodeZMoveWithState(z: number, state: GcodeEncoderState): string {
    const eps = BaseGCodeStrategy._posEps;
    if (!state.relative) {
      state.prevZ = z;
      return `G0 Z${z.toFixed(3)}`;
    }
    const dz = z - state.prevZ;
    state.prevZ = z;
    if (Math.abs(dz) < eps) return '; Z skipped (no motion)';
    return `G0 Z${dz.toFixed(3)}`;
  }

  private encodeFooterWithState(
    job: Job,
    options: GcodeGenerateOptions | undefined,
    totalLines: number,
    state: GcodeEncoderState,
  ): string {
    const extras: string[] = [];
    const pre = options?.customEndGcode?.trim();
    if (pre) {
      for (const line of pre.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0)) {
        extras.push(line);
      }
    }
    if (options?.gcodeFooterTemplate) {
      const templateContext = {
        ...(options.gcodeTemplateContext ?? {
          ...emptyTemplateContext(),
          jobName: job.name || 'untitled',
        }),
        totalLines,
      };
      const renderedFooter = renderTemplate(options.gcodeFooterTemplate, templateContext);
      if (renderedFooter.trim().length > 0) {
        const footerParts = renderedFooter.split(/\r?\n/).map(l => l.trimEnd());
        for (let i = 0; i < footerParts.length; i++) {
          extras.push(footerParts[i]);
        }
      }
    }

    const safetyFooter: string[] = [];
    safetyFooter.push(`${this.encodeLaserOff()} ; T2-14 safety baseline: laser off at end`);
    state.laserModalArmed = false;
    if (state.relative) {
      const backX = -state.prevPos.x;
      const backY = -state.prevPos.y;
      const eps = BaseGCodeStrategy._posEps;
      if (Math.abs(backX) > eps || Math.abs(backY) > eps) {
        safetyFooter.push(`G0 X${backX.toFixed(3)} Y${backY.toFixed(3)} ; return to start`);
      }
      safetyFooter.push('G90 ; restore absolute positioning');
    } else {
      const rp = options?.returnPosition;
      if (
        rp != null &&
        Number.isFinite(rp.x) &&
        Number.isFinite(rp.y)
      ) {
        safetyFooter.push(`${this.encodeRapidWithState(rp, state)} ; return to job origin`);
      }
    }
    safetyFooter.push('M2 ; T2-14 safety baseline: program end');

    return [...extras, ...safetyFooter].join('\n');
  }

  private encodeMoveWithState(move: Move, state: GcodeEncoderState): string {
    switch (move.type) {
      case 'rapid':    return this.encodeRapidWithState(move.to, state);
      case 'linear':   return this.encodeLinearWithState(move.to, move.power, move.speed, state);
      case 'laserOn':  return this.encodeLaserOnWithState(move.power, state);
      case 'laserOff':
        state.laserModalArmed = false;
        return this.encodeLaserOff();
      case 'dwell':    return this.encodeDwell(move.ms);
      case 'setAir':   return this.encodeAirAssistForCommand(move.on, state.airAssistCommand);
      case 'setZ':     return this.encodeZMoveWithState(move.z, state);
      case 'marker':
        return `; OBJ ids=${move.sourceObjectIds.join(',')}`;
    }
  }
}

interface GcodeEncoderState {
  currentSpeed: number;
  hardOffZeroPowerLinearMoves: boolean;
  hardOffRapidMoves: boolean;
  maxSpindle: number;
  grblLaserPowerMode: GrblLaserPowerMode;
  airAssistCommand: AirAssistCommand;
  prevPos: { x: number; y: number };
  relative: boolean;
  prevZ: number;
  laserModalArmed: boolean;
}

function validateTemplatesBeforeEmission(
  job: Job,
  options: GcodeGenerateOptions | undefined,
  maxSpindle: number,
): void {
  if (!options) return;
  const hasTemplateInput = Boolean(
    options.customStartGcode?.trim() ||
    options.customEndGcode?.trim() ||
    options.gcodeHeaderTemplate?.trim() ||
    options.gcodeFooterTemplate?.trim(),
  );
  if (!hasTemplateInput) return;

  const templateContext = options.gcodeTemplateContext ?? {
    ...emptyTemplateContext(),
    jobName: job.name || 'untitled',
  };
  const findings = validateGcodeTemplates({
    customStart: options.customStartGcode,
    customEnd: options.customEndGcode,
    headerTemplate: options.gcodeHeaderTemplate,
    footerTemplate: options.gcodeFooterTemplate,
    templateContext,
    bedWidthMm: templateContext.bedWidthMm,
    bedHeightMm: templateContext.bedHeightMm,
    maxSpindle,
  });
  // T1-168 (audit F-025): aggregate every error finding into one
  // throw, and attach the warning findings. Pre-T1-168 we threw on
  // the first error and discarded the remaining error + warning
  // findings entirely; a 3-error template required 3 compile
  // roundtrips to surface.
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  if (errors.length > 0) {
    throw new TemplateValidationError(errors, warnings);
  }
}

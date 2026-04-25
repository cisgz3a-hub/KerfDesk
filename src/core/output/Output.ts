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

// ─── OUTPUT FORMAT ───────────────────────────────────────────────

export type OutputFormat = 'grbl' | 'marlin' | 'smoothie' | 'ruida' | 'custom';

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

import { type Plan, type Move } from '../plan/Plan';
import { type Job } from '../job/Job';
import { type GcodeGenerateOptions } from './GcodeOrigin';
import { emptyTemplateContext, renderTemplate } from '../plan/GcodeTemplates';

export type { GcodeGenerateOptions, GcodeStartMode } from './GcodeOrigin';

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

  generate(plan: Plan, job: Job, options?: GcodeGenerateOptions): Output {
    this.currentSpeed = 0;
    this._maxSpindle = options?.maxSpindle ?? 1000;
    this._relative = options?.startMode === 'current';
    this._prevPos = { x: 0, y: 0 };
    this._prevZ = 0;

    try {
      const lines: string[] = [];
      const header = this.encodeHeader(job, options);
      const headerLines = header.split(/\r?\n/);
      for (let i = 0; i < headerLines.length; i++) {
        lines.push(headerLines[i]);
      }

      for (const op of plan.operations) {
        const srcOp = job.operations.find(o => o.id === op.operationId);
        const passes = Math.max(1, srcOp?.settings.passes ?? 1);
        lines.push('');
        if (passes > 1) {
          lines.push(`; --- ${op.layerName} (pass ${op.passIndex + 1}/${passes}) ---`);
        } else {
          lines.push(`; --- ${op.layerName} (pass ${op.passIndex + 1}) ---`);
        }

        for (const move of op.moves) {
          lines.push(this.encodeMove(move));
        }
      }

      // Template footer path does not call encodeRapid for RETURN_X/Y — it emits
      // literal G0 X0 Y0 when returnPosition is (0,0), which is a no-op in G91.
      // Inject the true relative return here so the head returns to the pre-Job
      // position before the template block runs. Non-template footers already
      // append this inside encodeFooter(); skip when no template to avoid duplicating.
      if (this._relative && options?.gcodeFooterTemplate?.trim()) {
        const backX = -this._prevPos.x;
        const backY = -this._prevPos.y;
        const eps = BaseGCodeStrategy._posEps;
        if (Math.abs(backX) > eps || Math.abs(backY) > eps) {
          lines.push(`G0 X${backX.toFixed(3)} Y${backY.toFixed(3)} ; return to start`);
          this._prevPos = { x: 0, y: 0 };
        }
      }

      lines.push('');
      const previewFooter = this.encodeFooter(job, options, lines.length + 1);
      const footerLineCount = previewFooter.length > 0 ? previewFooter.split(/\r?\n/).length : 0;
      const totalLines = lines.length + footerLineCount;
      const footer = this.encodeFooter(job, options, totalLines);
      const footerLines = footer.split(/\r?\n/);
      for (let i = 0; i < footerLines.length; i++) {
        lines.push(footerLines[i]);
      }

      const text = lines.filter(l => l !== undefined).join('\n');

      return {
        id: generateId(),
        planId: plan.id,
        format: this.formatId,
        createdAt: new Date().toISOString(),
        text,
        lineCount: lines.length,
        binary: null,
        fileSizeBytes: new TextEncoder().encode(text).length,
      };
    } finally {
      this.currentSpeed = 0;
      this._relative = false;
      this._prevPos = { x: 0, y: 0 };
      this._prevZ = 0;
    }
  }

  encodeHeader(job: Job, options?: GcodeGenerateOptions): string {
    const useRelative = options?.startMode === 'current';
    const defaultBlock = [
      `; Generated by LaserForge`,
      `; Job: ${job.name}`,
      `; Date: ${new Date().toISOString()}`,
      `; Objects: ${job.metadata.objectCount}, Layers: ${job.metadata.layerCount}`,
      'G21 ; mm mode',
      useRelative ? 'G91 ; relative positioning (Head mode)' : 'G90 ; absolute positioning',
      this.encodeLaserOff(),
    ].join('\n');

    let base = options?.gcodeHeaderTemplate
      ? renderTemplate(
        options.gcodeHeaderTemplate,
        options.gcodeTemplateContext ?? {
          ...emptyTemplateContext(),
          jobName: job.name || 'untitled',
        },
      )
      : defaultBlock;

    if (options?.gcodeHeaderTemplate && useRelative) {
      base = [base, 'G91 ; LaserForge: Head mode requires relative positioning'].join('\n');
    }

    const extra = options?.customStartGcode?.trim();
    if (!extra) return base;
    const lines = extra.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
    return lines.length ? [base, ...lines].join('\n') : base;
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

    const dx = to.x - this._prevPos.x;
    const dy = to.y - this._prevPos.y;
    this._prevPos = { x: to.x, y: to.y };

    const parts: string[] = ['G1'];
    if (Math.abs(dx) >= eps) parts.push(`X${dx.toFixed(3)}`);
    if (Math.abs(dy) >= eps) parts.push(`Y${dy.toFixed(3)}`);

    if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
      if (speed !== this.currentSpeed) {
        parts.push(`F${speed.toFixed(0)}`);
        this.currentSpeed = speed;
      }
      parts.push(this.encodePowerValue(power));
      return parts.length > 1 ? parts.join(' ') : '; G1 skipped (no motion)';
    }

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
    const parts: string[] = [];
    const pre = options?.customEndGcode?.trim();
    if (pre) {
      for (const line of pre.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0)) {
        parts.push(line);
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
          parts.push(footerParts[i]);
        }
      }
      const hasProgramEnd = parts.some(l => /\bM2\b/i.test(l) || /\bM30\b/i.test(l));
      if (!hasProgramEnd) {
        parts.push('M2 ; program end');
      }
      if (this._relative) {
        parts.push('G90 ; restore absolute positioning');
      }
    } else {
      parts.push(this.encodeLaserOff());
      if (this._relative) {
        const backX = -this._prevPos.x;
        const backY = -this._prevPos.y;
        const eps = BaseGCodeStrategy._posEps;
        if (Math.abs(backX) > eps || Math.abs(backY) > eps) {
          parts.push(`G0 X${backX.toFixed(3)} Y${backY.toFixed(3)} ; return to start`);
        }
        parts.push('G90 ; restore absolute positioning');
      } else {
        const rp = options?.returnPosition;
        if (
          rp != null &&
          Number.isFinite(rp.x) &&
          Number.isFinite(rp.y)
        ) {
          parts.push(`${this.encodeRapid(rp)} ; return to job origin`);
        }
      }
      parts.push('M2 ; program end');
    }
    return parts.join('\n');
  }

  private encodeMove(move: Move): string {
    switch (move.type) {
      case 'rapid':    return this.encodeRapid(move.to);
      case 'linear':   return this.encodeLinear(move.to, move.power, move.speed);
      case 'laserOn':  return this.encodeLaserOn(move.power);
      case 'laserOff': return this.encodeLaserOff();
      case 'dwell':    return this.encodeDwell(move.ms);
      case 'setAir':   return this.encodeAirAssist(move.on);
      case 'setZ':     return this.encodeZMove(move.z);
      case 'marker':
        return `; OBJ ids=${move.sourceObjectIds.join(',')}`;
    }
  }
}

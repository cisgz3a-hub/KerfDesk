/**
 * Pipeline orchestration — standalone, no React dependency.
 *
 * Owns the full compile chain:
 *   Scene → expandText → Job → Plan → MachineTransform → Output
 *
 * Returns structured results so callers (React hooks, tests, CLI)
 * get everything they need in one call.
 */

import { type Scene } from '../core/scene/Scene';
import { type AABB } from '../core/types';
import { type Move } from '../core/plan/Plan';
import { type MachineTransformResult, applyMachineTransform } from '../core/plan/MachineTransform';
import { type GcodeStartMode } from '../core/output/GcodeOrigin';
import { type OutputFormat } from '../core/output/Output';
import { compileJob } from '../core/job/JobCompiler';
import { optimizePlan } from '../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../core/output/Output';
import '../core/output/GrblStrategy';
import { getActiveProfile, type DeviceProfile, type MachineOriginCorner } from '../core/devices/DeviceProfile';
import { expandTextOutlinesForCompile } from '../geometry/expandTextForCompile';
import { generateTicketId, hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
import type { ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  emptyTemplateContext,
} from '../core/plan/GcodeTemplates';

const DEFAULT_MACHINE_BED_MM = 300;

/** Prefer controller $130/$131, then profile, then default — same priority as compile path. */
export function resolveBedWidthMm(
  profile: ReturnType<typeof getActiveProfile>,
  machineBedFromController: { width: number; height: number } | null | undefined,
): number {
  const wCtrl = machineBedFromController?.width;
  if (typeof wCtrl === 'number' && Number.isFinite(wCtrl) && wCtrl > 0) return wCtrl;
  const wProf = profile?.bedWidth;
  if (typeof wProf === 'number' && Number.isFinite(wProf) && wProf > 0) return wProf;
  return DEFAULT_MACHINE_BED_MM;
}

/** Prefer controller $130/$131, then profile, then default — same priority as compile path. */
export function resolveBedHeightMm(
  profile: ReturnType<typeof getActiveProfile>,
  machineBedFromController: { width: number; height: number } | null | undefined,
): number {
  const hCtrl = machineBedFromController?.height;
  if (typeof hCtrl === 'number' && Number.isFinite(hCtrl) && hCtrl > 0) return hCtrl;
  const hProf = profile?.bedHeight;
  if (typeof hProf === 'number' && Number.isFinite(hProf) && hProf > 0) return hProf;
  return DEFAULT_MACHINE_BED_MM;
}

function resolveOriginCorner(profile: ReturnType<typeof getActiveProfile>): MachineOriginCorner {
  return profile?.originCorner
    ?? (profile?.invertY === false ? 'rear-left' : 'front-left');
}

// ─── RESULT TYPES ──────────────────────────────────────────────

export interface CompileGcodeResult {
  gcode: string;
  machineTransform: MachineTransformResult;
  machinePlanBounds: AABB;
  /** Canvas-space moves for toolpath preview overlay. */
  canvasMoves: Move[];
  canvasPlanBounds: AABB;
  failedTextObjects: string[];
  /** Execution-contract ticket (phase 1: built here; consumed by later phases). */
  ticket: ValidatedJobTicket;
}

export interface CompileToolpathResult {
  moves: Move[];
  bounds: AABB;
  failedTextObjects: string[];
}

// ─── COMPILE G-CODE ────────────────────────────────────────────

/**
 * T2-17: optional cooperative-cancel + progress hooks for compileGcode.
 * Pre-T2-17 the compile was uncancellable internally — once started,
 * every loop ran to completion. The hooks here let the UI surface a
 * Cancel button + progress bar across phase boundaries and through
 * JobCompiler / PlanOptimizer deep loops. Output generation remains a
 * later T2-17 follow-up. Aborting at a checkpoint throws an AbortError;
 * pre-existing callers that don't pass `opts` see no behavior change.
 */
export interface CompileOptions {
  signal?: AbortSignal;
  onProgress?: (event: CompileProgress) => void;
}

export interface CompileProgress {
  phase: 'text-expansion' | 'compile-job' | 'plan' | 'transform' | 'output';
  /** 0..1 within the current phase. MVP fires at boundaries (0 entering,
   *  1 finishing); deep-loop instrumentation in T2-17-followup will
   *  emit intermediate values. */
  fraction: number;
  /** 0..1 across the whole compile. Monotonically non-decreasing. */
  overallFraction: number;
  detail?: string;
}

const PHASE_BUDGETS: Record<CompileProgress['phase'], number> = {
  'text-expansion': 0.10,
  'compile-job':    0.30,
  'plan':           0.30,
  'transform':      0.10,
  'output':         0.20,
};

function phaseStartFraction(phase: CompileProgress['phase']): number {
  let acc = 0;
  for (const p of ['text-expansion', 'compile-job', 'plan', 'transform', 'output'] as const) {
    if (p === phase) return acc;
    acc += PHASE_BUDGETS[p];
  }
  return acc;
}

/**
 * Throws an AbortError-shaped DOMException when the signal is aborted,
 * otherwise returns. Matches the contract `AbortSignal.throwIfAborted()`
 * but works on older Node where the helper isn't available.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Compile cancelled', 'AbortError');
  }
}

function reportPhase(
  opts: CompileOptions | undefined,
  phase: CompileProgress['phase'],
  fraction: number,
  detail?: string,
): void {
  if (!opts?.onProgress) return;
  const start = phaseStartFraction(phase);
  const overall = start + PHASE_BUDGETS[phase] * Math.max(0, Math.min(1, fraction));
  opts.onProgress({ phase, fraction, overallFraction: overall, detail });
}

/**
 * Full pipeline: Scene → G-code string + all intermediate data.
 *
 * Returns null if the scene produces no operations (empty/hidden layers).
 */
export async function compileGcode(
  scene: Scene,
  startMode: GcodeStartMode = 'current',
  savedOrigin: { x: number; y: number } | null = null,
  /** Auto-detected GRBL $30. Fallback when device profile has no maxSpindle. */
  controllerMaxSpindle: number | null = null,
  outputFormat: OutputFormat = 'grbl',
  /** GRBL $$ bed ($131) when connected; overrides profile height for Y mapping only. */
  machineBedFromController: { width: number; height: number } | null = null,
  /** GRBL $120/$121 (min); raster acceleration-aware power. */
  controllerAccelMmPerS2: number | null = null,
  /**
   * T1-58: profile snapshot taken by the caller at compile-entry. Required.
   * Pre-T1-58 the pipeline read `getActiveProfile()` internally — a global
   * read mid-compile that, if the active profile flipped between caller's
   * decision-to-compile and the read (programmatic profile change, import,
   * cross-tab storage event), produced a result computed against a profile
   * the UI didn't know was active. Snapshotting at the call site (and
   * passing the snapshot here) makes the compile pure w.r.t. profile state
   * and lets the caller detect race-condition staleness via hash compare
   * after await. `null` is allowed for the no-profile case (offline export
   * with no settings ever configured); fallbacks below preserve the
   * pre-T1-58 default behavior in that branch.
   */
  profile: DeviceProfile | null = null,
  /**
   * T2-17: optional AbortSignal + progress callback. Phase-boundary
   * checkpoints plus JobCompiler / PlanOptimizer deep-loop checkpoints.
   * Defaults to `{}` so existing callers see no behavior change.
   */
  opts: CompileOptions = {},
): Promise<CompileGcodeResult | null> {
  // T2-17: phase 1 — text expansion.
  throwIfAborted(opts.signal);
  reportPhase(opts, 'text-expansion', 0, 'Expanding text outlines');
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);
  reportPhase(opts, 'text-expansion', 1);

  const strategy = getOutputStrategy(outputFormat);
  if (!strategy) return null;

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}. These text objects will be excluded from the job. Try a larger font size or bolder font.`,
    );
  }

  // T2-17: phase 2 — JobCompiler.
  throwIfAborted(opts.signal);
  reportPhase(opts, 'compile-job', 0, 'Compiling job operations');
  const job = compileJob(sceneForJob, {
    machineAccelMmPerS2: controllerAccelMmPerS2,
    strategySupportsDynamicLaserPower: strategy.supportsDynamicLaserPower ?? false,
    signal: opts.signal,
    onProgress: (event) => {
      reportPhase(opts, 'compile-job', event.fraction, event.detail ?? 'Compiling job operations');
    },
  });
  reportPhase(opts, 'compile-job', 1);
  if (job.operations.length === 0) return null;

  // T1-58: `profile` parameter is the caller's snapshot. The pre-T1-58
  // `getActiveProfile()` global read is gone from this function.
  // T2-17: phase 3 — PlanOptimizer.
  throwIfAborted(opts.signal);
  reportPhase(opts, 'plan', 0, 'Optimizing toolpath');
  const plan = optimizePlan(job, {
    maxRapidSpeed: profile?.maxFeedRate ?? 6000,
    signal: opts.signal,
    onProgress: (event) => {
      reportPhase(opts, 'plan', event.fraction, event.detail ?? 'Optimizing toolpath');
    },
  });
  reportPhase(opts, 'plan', 1);

  // Canvas-space data for preview
  const canvasMoves = plan.operations.flatMap(op => op.moves);
  const canvasPlanBounds = { ...plan.bounds };

  const originCorner = resolveOriginCorner(profile);
  const bedWidthMm = resolveBedWidthMm(profile, machineBedFromController);
  const bedHeightMm = resolveBedHeightMm(profile, machineBedFromController);

  // T1-33: when the controller reports a positive $30, controller value wins
  // over profile.maxSpindle. Profile is fallback only. Reason: profile defaults
  // to 1000 for most entries, but Falcon firmware ships with $30=255 (newer)
  // and other controllers vary. If profile=1000 and $30=255, generating S=500
  // for "50% power" lets firmware clamp internally to 255 — actual output is
  // 100% (255/255), not 50%. Over-power is a fire hazard on flammable
  // materials. The mismatch detection (T1-33 Part 2) raises a blocking
  // preflight error so the user explicitly reconciles the values; this
  // precedence flip is the runtime guard if they bypass preflight or run
  // through a code path that doesn't call it.
  const maxSpindle =
    (controllerMaxSpindle != null && controllerMaxSpindle > 0)
      ? controllerMaxSpindle
      : (profile?.maxSpindle ?? 1000);

  // Machine-space data for output. T1-40: bedWidthMm is required when
  // originCorner is front-right or rear-right; we always pass it so
  // the transform can mirror X for those configurations.
  // T2-17: phase 4 — machine-space transform.
  throwIfAborted(opts.signal);
  reportPhase(opts, 'transform', 0, 'Applying machine transform');
  const machineTransform = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    originCorner,
    bedHeightMm,
    bedWidthMm,
  });
  reportPhase(opts, 'transform', 1);

  // T2-17: phase 5 — Output (g-code emission).
  throwIfAborted(opts.signal);
  reportPhase(opts, 'output', 0, 'Emitting G-code');
  const output = strategy.generate(machineTransform.plan, job, {
    startMode,
    savedOrigin,
    returnPosition: (profile?.returnToOrigin ?? true)
      ? machineTransform.returnPosition
      : null,
    customStartGcode: profile?.startGcode,
    customEndGcode: profile?.endGcode,
    gcodeHeaderTemplate: profile?.gcodeHeaderTemplate,
    gcodeFooterTemplate:
      (profile?.returnToOrigin ?? true)
        ? profile?.gcodeFooterTemplate
        : (profile?.gcodeFooterTemplate === BUILT_IN_FOOTER_TEMPLATES[DEFAULT_FOOTER_TEMPLATE_NAME]
            ? BUILT_IN_FOOTER_TEMPLATES['Stay in place']
            : profile?.gcodeFooterTemplate),
    gcodeTemplateContext: {
      ...emptyTemplateContext(),
      jobName: scene.metadata?.name || job.name || 'untitled',
      bedWidthMm,
      bedHeightMm,
      maxSpeedMmPerMin: Math.max(0, ...job.operations.map(op => op.settings.speed)),
      materialName: scene.material?.name ?? '',
      materialThicknessMm: scene.material?.thickness ?? 0,
      estimatedTime: 'TBD',
      returnX: machineTransform.returnPosition.x,
      returnY: machineTransform.returnPosition.y,
    },
    maxSpindle,
  });
  if (!output.text) return null;
  reportPhase(opts, 'output', 1);

  const gcode = output.text;
  const gcodeLines = gcode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const ticket: ValidatedJobTicket = {
    ticketId: generateTicketId(),
    sceneHash: hashSceneForTicket(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcode),
    gcodeLines,
    gcodeText: gcode,
    machinePlanBounds: { ...machineTransform.plan.bounds },
    machineTransform,
    controllerType: 'grbl',
    startMode,
    savedOrigin,
    createdAt: Date.now(),
  };

  return {
    gcode,
    machineTransform,
    machinePlanBounds: { ...machineTransform.plan.bounds },
    canvasMoves,
    canvasPlanBounds,
    failedTextObjects,
    ticket,
  };
}

// ─── COMPILE TOOLPATH ──────────────────────────────────────────

/**
 * Compile scene to canvas-space moves for toolpath preview.
 * Does NOT apply MachineTransform — coordinates stay in canvas space.
 */
export async function compileToolpath(
  scene: Scene,
  controllerAccelMmPerS2: number | null = null,
  /**
   * T1-58: profile snapshot for `maxFeedRate` resolution (only profile
   * field this path reads). Same reasoning as `compileGcode`: pure w.r.t.
   * profile state. `null` is allowed; fallback to 6000 mm/min preserves
   * pre-T1-58 behavior.
   */
  profile: DeviceProfile | null = null,
): Promise<CompileToolpathResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);
  const strategy = getOutputStrategy('grbl');

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}`,
    );
  }

  const job = compileJob(sceneForJob, {
    machineAccelMmPerS2: controllerAccelMmPerS2,
    strategySupportsDynamicLaserPower: strategy?.supportsDynamicLaserPower ?? false,
  });
  if (job.operations.length === 0) return null;

  // T1-58: `profile` parameter is the caller's snapshot. The pre-T1-58
  // `getActiveProfile()` global read is gone from this function.
  const plan = optimizePlan(job, {
    maxRapidSpeed: profile?.maxFeedRate ?? 6000,
  });
  const moves = plan.operations.flatMap(op => op.moves);

  return {
    moves,
    bounds: { ...plan.bounds },
    failedTextObjects,
  };
}

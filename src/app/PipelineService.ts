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
import {
  getOutputStrategy,
  type OutputFormat,
  type StreamingGcodeGenerateOptions,
} from '../core/output/Output';
import { collectStreamingOutput } from '../core/output/GcodeStreaming';
import { compileJob } from '../core/job/JobCompiler';
import { optimizePlan } from '../core/plan/PlanOptimizer';
import '../core/output/GrblStrategy';
import { getActiveProfile, type DeviceProfile, type MachineOriginCorner } from '../core/devices/DeviceProfile';
import {
  applyProfileOverrides,
  grblCapabilities,
  type ControllerCapabilities,
  type OutputFormat as ControllerCapabilityOutputFormat,
  type ProfileOverrides,
} from '../controllers/ControllerCapabilities';
import { expandTextOutlinesForCompile } from '../geometry/expandTextForCompile';
import { generateTicketId, hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
// T1-181 (external audit High #1 + #3): determinism gate — hash
// entitlement-policy + referenced material presets at compile time
// so the start-time validator can detect input divergence.
import {
  captureEntitlementPolicySnapshot,
  hashEntitlementPolicy,
  hashReferencedMaterialPresets,
} from '../core/job/compileInputHashes';
import { buildJobFingerprint, type JobFingerprint } from '../core/job/JobFingerprint';
// T1-182 (external audit High #2 + #8): canonical burn envelope
// derived from the EMITTED gcode (not the upstream `Plan`). Attaches
// to the ticket so future preview / validation code can consume the
// real post-emission geometry, addressing the audit's "preview may
// not match the actual program" framing.
import { analyzeEmittedBurnEnvelope } from '../core/output/emittedBurnEnvelope';
// T1-188 (external audit High #2 + #8 wiring): consistency gate
// between plan-derived burn envelope and emitted-gcode burn envelope.
// Catches encoder bugs (pre-T1-173 raster overscan, pre-T1-180
// zero-distance dwell-burn) at compile time, before the ticket is
// presented for approval.
import { checkBurnEnvelopeDivergence, computePlanBurnEnvelope } from '../core/output/burnEnvelopeDivergence';
// T1-195 (extends T1-193): persist burn-envelope divergence events
// to the shared ledger so support bundles can correlate compile-time
// encoder regressions with the runtime stream they affected.
import { getMachineEventLedger } from './MachineEventLedger';
import type { ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import {
  BUILT_IN_FOOTER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  emptyTemplateContext,
} from '../core/plan/GcodeTemplates';

const DEFAULT_MACHINE_BED_MM = 300;
const OUTPUT_FORMATS: readonly OutputFormat[] = ['grbl', 'marlin', 'smoothie', 'ruida', 'custom'];

type OutputTargetSource = 'profile-preference' | 'controller-default' | 'legacy-fallback';

export interface OutputTarget {
  readonly format: OutputFormat;
  readonly dialect: string;
  readonly controllerFormat: ControllerCapabilityOutputFormat;
  readonly source: OutputTargetSource;
}

const OUTPUT_FORMAT_TO_CONTROLLER_FORMAT: Record<OutputFormat, ControllerCapabilityOutputFormat> = {
  grbl: 'gcode-text',
  marlin: 'gcode-text',
  smoothie: 'gcode-text',
  ruida: 'gcode-binary',
  custom: 'native-binary',
};

function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && (OUTPUT_FORMATS as readonly string[]).includes(value);
}

function controllerSupportsOutput(
  caps: ControllerCapabilities,
  format: OutputFormat,
): boolean {
  return caps.output.formats.includes(OUTPUT_FORMAT_TO_CONTROLLER_FORMAT[format]);
}

function makeOutputTarget(
  format: OutputFormat,
  profile: DeviceProfile | null,
  source: OutputTargetSource,
): OutputTarget {
  return {
    format,
    dialect: profile?.outputDialect?.trim() || format,
    controllerFormat: OUTPUT_FORMAT_TO_CONTROLLER_FORMAT[format],
    source,
  };
}

/**
 * T2-28: resolve the output strategy from profile preference + controller
 * capabilities instead of hardcoding GRBL at each compile surface.
 */
export function resolveOutputTarget(
  profile: DeviceProfile | null,
  controllerCapabilities: ControllerCapabilities = grblCapabilities,
  legacyFallbackFormat: OutputFormat = 'grbl',
): OutputTarget {
  const preferred = isOutputFormat(profile?.outputFormat) ? profile.outputFormat : null;
  if (preferred && controllerSupportsOutput(controllerCapabilities, preferred)) {
    return makeOutputTarget(preferred, profile, 'profile-preference');
  }

  for (const format of OUTPUT_FORMATS) {
    if (controllerSupportsOutput(controllerCapabilities, format)) {
      return makeOutputTarget(format, profile, 'controller-default');
    }
  }

  return makeOutputTarget(legacyFallbackFormat, profile, 'legacy-fallback');
}

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

/**
 * T1-218 (v30 audit #1): companion to `resolveBedWidthMm` /
 * `resolveBedHeightMm` that returns `true` when BOTH dimensions
 * came from a real source (controller-reported `$130/$131` or an
 * explicit profile setting) and `false` when either falls back to
 * `DEFAULT_MACHINE_BED_MM` (the 300mm safety hole the audit
 * flagged).
 *
 * Audit's real-world failure: a 100×100 mm or 220×220 mm laser
 * with missing `$130/$131` and missing profile dimensions
 * silently compiles/transforms against a phantom 300mm bed, then
 * drives motion outside its actual work envelope.
 *
 * Caller (UI) passes this into preflight so the existing
 * `MISSING_BED_SIZE` blocker fires when the bed is fallback-only,
 * rather than being masked by the 300mm substitution.
 */
export function bedDimensionsKnown(
  profile: ReturnType<typeof getActiveProfile>,
  machineBedFromController: { width: number; height: number } | null | undefined,
): boolean {
  const wCtrl = machineBedFromController?.width;
  const hCtrl = machineBedFromController?.height;
  const ctrlKnown =
    typeof wCtrl === 'number' && Number.isFinite(wCtrl) && wCtrl > 0
    && typeof hCtrl === 'number' && Number.isFinite(hCtrl) && hCtrl > 0;
  if (ctrlKnown) return true;
  const wProf = profile?.bedWidth;
  const hProf = profile?.bedHeight;
  return (
    typeof wProf === 'number' && Number.isFinite(wProf) && wProf > 0
    && typeof hProf === 'number' && Number.isFinite(hProf) && hProf > 0
  );
}

function resolveOriginCorner(profile: ReturnType<typeof getActiveProfile>): MachineOriginCorner {
  return profile?.originCorner
    ?? (profile?.invertY === false ? 'rear-left' : 'front-left');
}

/**
 * T1-224 / F-011: map the active `DeviceProfile` fields into the
 * first-class `ControllerCapabilities` model. Pre-T1-224,
 * `applyProfileOverrides` was tested in isolation but no production
 * compile path consumed it, so profile-specific authority such as
 * `homingEnabled`, autofocus support, bed size, and max spindle never
 * reached the capability model.
 */
export function profileToControllerCapabilityOverrides(
  profile: DeviceProfile | null,
): ProfileOverrides {
  if (!profile) return {};
  return {
    homingEnabled: profile.homingEnabled,
    autofocusSupported: profile.autoFocusSupported,
    bedWidthMm: profile.bedWidth,
    bedHeightMm: profile.bedHeight,
    maxPowerValue: profile.maxSpindle,
  };
}

/**
 * Production capability resolver for the pipeline. Callers may pass a
 * controller-family capability declaration; the active profile then
 * narrows/overrides the parts that are user/profile authority.
 */
export function resolvePipelineControllerCapabilities(
  profile: DeviceProfile | null,
  base: ControllerCapabilities = grblCapabilities,
): ControllerCapabilities {
  return applyProfileOverrides(base, profileToControllerCapabilityOverrides(profile));
}

export interface PipelineJobFingerprintInputs {
  scene: Scene;
  startMode: GcodeStartMode;
  savedOrigin: { x: number; y: number } | null;
  profile: DeviceProfile | null;
  controllerMaxSpindle: number | null;
  outputFormat: OutputFormat;
  machineBedFromController: { width: number; height: number } | null;
  controllerAccelMmPerS2: number | null;
  controllerCapabilities?: ControllerCapabilities;
}

/**
 * T1-246: canonical fingerprint builder for the production compile and
 * start paths. Keeping the shape here prevents the audit failure where
 * a helper exists but compile/start rebuild different notions of "same
 * job."
 */
export function buildPipelineJobFingerprint(args: PipelineJobFingerprintInputs): JobFingerprint {
  const controllerCapabilities = resolvePipelineControllerCapabilities(
    args.profile,
    args.controllerCapabilities ?? grblCapabilities,
  );
  const outputTarget = resolveOutputTarget(args.profile, controllerCapabilities, args.outputFormat);
  const originCorner = resolveOriginCorner(args.profile);
  const bedWidthMm = resolveBedWidthMm(args.profile, args.machineBedFromController);
  const bedHeightMm = resolveBedHeightMm(args.profile, args.machineBedFromController);
  const maxSpindle =
    (args.controllerMaxSpindle != null && args.controllerMaxSpindle > 0)
      ? args.controllerMaxSpindle
      : (controllerCapabilities.laser.maxPowerValue > 0
          ? controllerCapabilities.laser.maxPowerValue
          : 1000);

  return buildJobFingerprint({
    scene: args.scene,
    profile: args.profile,
    materialSnapshot: hashReferencedMaterialPresets(args.scene),
    startMode: args.startMode,
    savedOrigin: args.savedOrigin,
    capabilities: {
      controllerCapabilities,
      outputTarget,
      maxSpindle,
      bedWidthMm,
      bedHeightMm,
      originCorner,
      controllerAccelMmPerS2: args.controllerAccelMmPerS2,
      returnToOrigin: args.profile?.returnToOrigin ?? true,
    },
    compileOptions: {
      outputFormat: args.outputFormat,
      sceneCompileOptions: args.scene.compileOptions ?? null,
    },
  });
}

// ─── RESULT TYPES ──────────────────────────────────────────────

export interface CompileGcodeResult {
  gcode: string;
  machineTransform: MachineTransformResult;
  machinePlanBounds: AABB;
  /** Canvas-space moves for toolpath preview overlay. */
  canvasMoves: Move[];
  /** Canvas-space laser-on envelope for framing. Excludes laser-off raster overscan. */
  canvasBurnBounds?: AABB | null;
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
 * JobCompiler / PlanOptimizer / Output deep loops. Aborting at a checkpoint throws an AbortError;
 * pre-existing callers that don't pass `opts` see no behavior change.
 */
export interface CompileOptions {
  signal?: AbortSignal;
  onProgress?: (event: CompileProgress) => void;
  controllerCapabilities?: ControllerCapabilities;
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
   * checkpoints plus JobCompiler / PlanOptimizer / Output deep-loop checkpoints.
   * Defaults to `{}` so existing callers see no behavior change.
   */
  opts: CompileOptions = {},
): Promise<CompileGcodeResult | null> {
  // T2-17: phase 1 — text expansion.
  throwIfAborted(opts.signal);
  reportPhase(opts, 'text-expansion', 0, 'Expanding text outlines');
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);
  reportPhase(opts, 'text-expansion', 1);

  const controllerCapabilities = resolvePipelineControllerCapabilities(profile, opts.controllerCapabilities ?? grblCapabilities);
  const outputTarget = resolveOutputTarget(profile, controllerCapabilities, outputFormat);
  const strategy = getOutputStrategy(outputTarget.format);
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
  const canvasBurnBounds = computePlanBurnEnvelope(plan).burnBounds;

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
      : (controllerCapabilities.laser.maxPowerValue > 0
          ? controllerCapabilities.laser.maxPowerValue
          : 1000);

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
  const gcodeOptions: StreamingGcodeGenerateOptions = {
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
    signal: opts.signal,
    onProgress: (event) => {
      reportPhase(opts, 'output', event.fraction, event.detail ?? 'Emitting G-code');
    },
  };
  let gcode: string | null = null;
  if (typeof strategy.generateGcode === 'function') {
    const streamed = await collectStreamingOutput(
      strategy.generateGcode(machineTransform.plan, job, gcodeOptions),
      opts.signal,
    );
    throwIfAborted(opts.signal);
    if (!streamed.sawLast) {
      throw new Error('Streaming G-code generation ended before the terminal chunk.');
    }
    gcode = streamed.lines.join('\n');
  } else {
    const output = strategy.generate(machineTransform.plan, job, gcodeOptions);
    gcode = output.text;
  }
  if (!gcode) return null;
  reportPhase(opts, 'output', 1);

  const gcodeLines = gcode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const fingerprint = buildPipelineJobFingerprint({
    scene,
    startMode,
    savedOrigin,
    profile,
    controllerMaxSpindle,
    outputFormat,
    machineBedFromController,
    controllerAccelMmPerS2,
    controllerCapabilities: opts.controllerCapabilities,
  });
  const ticket: ValidatedJobTicket = {
    ticketId: generateTicketId(),
    sceneHash: hashSceneForTicket(scene),
    profileHash: profile ? hashObject(profile) : hashString('no-profile'),
    gcodeHash: hashString(gcode),
    fingerprint,
    // T1-181 (audit High #1 + #3): capture compile-time entitlement
    // policy AND referenced-material-presets so the start-time
    // validator can detect divergence. See compileInputHashes.ts for
    // rationale.
    entitlementPolicyHash: hashEntitlementPolicy(captureEntitlementPolicySnapshot()),
    materialPresetsHash: hashReferencedMaterialPresets(scene),
    // T1-182 (audit High #2 + #8): canonical burn envelope derived
    // from the EMITTED gcode bytes (not the upstream Plan). Future
    // preview / validator code consumes this to ensure preview ↔
    // output cannot diverge silently. See emittedBurnEnvelope.ts
    // for the parser.
    emittedBurnBounds: analyzeEmittedBurnEnvelope(gcode).burnBounds,
    // T1-188 (audit High #2 + #8 wiring): compile-time consistency
    // check between the plan's burn envelope and the emitted gcode's
    // burn envelope. Null when they agree within tolerance (0.5 mm
    // per AABB edge); otherwise a structured report carrying the
    // mismatch kind + deltas for support-bundle diagnosis. Logged
    // via console.warn so support tooling captures the divergence
    // event even when no listener consumes the ticket field.
    burnEnvelopeDivergence: (() => {
      const report = checkBurnEnvelopeDivergence(machineTransform.plan, gcode);
      if (report !== null) {
        console.warn(
          `[T1-188] Burn-envelope divergence detected (kind=${report.kind}, `
          + `maxEdgeDeltaMm=${report.maxEdgeDeltaMm.toFixed(3)}, `
          + `planMoves=${report.planBurnMoveCount}, emittedMoves=${report.emittedBurnMoveCount}). `
          + 'The emitted gcode produces a different burn region than the planned preview. '
          + 'Check the encoder for new bugs introduced by recent edits.',
        );
        // T1-195: persist the divergence event so support bundles
        // can correlate the runtime stream with the compile-time
        // detection. The maxEdgeDeltaMm field is finite for
        // 'envelope-edge-mismatch'; the empty/non-empty cases set
        // it to Infinity, which we replace with -1 here for JSON
        // safety (Infinity isn't JSON-representable).
        getMachineEventLedger().append({
          kind: 'burn-envelope-divergence',
          t: Date.now(),
          divergenceKind: report.kind,
          maxEdgeDeltaMm: Number.isFinite(report.maxEdgeDeltaMm) ? report.maxEdgeDeltaMm : -1,
        });
      }
      return report;
    })(),
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
    canvasBurnBounds: canvasBurnBounds ? { ...canvasBurnBounds } : null,
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
  outputFormat: OutputFormat = 'grbl',
  controllerCapabilities: ControllerCapabilities = grblCapabilities,
): Promise<CompileToolpathResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);
  const resolvedControllerCapabilities = resolvePipelineControllerCapabilities(profile, controllerCapabilities);
  const outputTarget = resolveOutputTarget(profile, resolvedControllerCapabilities, outputFormat);
  const strategy = getOutputStrategy(outputTarget.format);

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

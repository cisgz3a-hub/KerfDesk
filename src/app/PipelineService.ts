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
import { getActiveProfile, type MachineOriginCorner } from '../core/devices/DeviceProfile';
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
): Promise<CompileGcodeResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);
  const strategy = getOutputStrategy(outputFormat);
  if (!strategy) return null;

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}. These text objects will be excluded from the job. Try a larger font size or bolder font.`,
    );
  }

  const job = compileJob(sceneForJob, {
    machineAccelMmPerS2: controllerAccelMmPerS2,
    strategySupportsDynamicLaserPower: strategy.supportsDynamicLaserPower ?? false,
  });
  if (job.operations.length === 0) return null;

  const profile = getActiveProfile();

  const plan = optimizePlan(job, {
    maxRapidSpeed: profile?.maxFeedRate ?? 6000,
  });

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
  const machineTransform = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    originCorner,
    bedHeightMm,
    bedWidthMm,
  });

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

  const profile = getActiveProfile();
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

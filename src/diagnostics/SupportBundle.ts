/**
 * T2-108: support bundle exporter — `Help → Export Diagnostic Bundle`.
 * Pre-T2-108 there was no way to export a diagnostic package for
 * support; the workflow degraded to "screenshots + ask questions" —
 * slow, lossy, not commercial-grade. Audit 5C Critical 1 + Required
 * Priority 2.
 *
 * T2-108 ships **Phase 1** — the bundle-assembly logic. Inputs are
 * the various subsystem snapshots (job logs, errors, crash reports,
 * etc); output is a structured `SupportBundle` whose `files` map
 * (filename → JSON-serialised content) is ready for a downstream
 * ZIP step. Privacy is enforced through T2-115's redaction layer:
 * license keys are ALWAYS redacted regardless of caller options;
 * project-name redaction is on by default; G-code / project files /
 * raw images are opt-in.
 *
 * Threading the assembled `SupportBundle` into the actual ZIP +
 * `Help → ...` UI is filed as T2-108-followup-Phase-2 (UI dialog +
 * file dialog + opening the containing folder); the ZIP packaging
 * itself is T2-108-followup-Phase-3.
 */
import { redactObject, defaultRedactionOptions, type RedactionOptions } from './Redaction';
import type { CorrelationIds } from './CorrelationIds';

/**
 * The bundle's `manifest.json` records what was included (and what
 * was redacted) so a support engineer reading the bundle 6 months
 * later can tell what version of the schema and what user choices
 * shaped the contents.
 */
export interface SupportBundleManifest {
  schemaVersion: 1;
  bundleId: string;
  generatedAt: string;
  appVersion: string;
  /**
   * What the user opted into. The defaults are minimal-PII, max-
   * useful for support; the user opts UP for the privileged inclusions.
   */
  inclusions: SupportBundleInclusions;
  /** Mirror of the redaction options applied to non-opt-in content. */
  redaction: RedactionOptions;
}

export interface SupportBundleInclusions {
  /** Last N job logs. Always included; capped at 20. */
  jobLogs: boolean;
  /** Last N error reports (T2-65). Always included. */
  errors: boolean;
  /** Last N crash reports (T2-114). Always included. */
  crashes: boolean;
  /** Active machine profile snapshot (T2-71). Always included. */
  machineProfile: boolean;
  /** Storage health (T2-116). Always included. */
  storage: boolean;
  /** Correlation IDs (T2-117). Always included. */
  correlation: boolean;
  /** G-code from recent jobs. OPT-IN. */
  gcode: boolean;
  /** Project file. OPT-IN. */
  projectFile: boolean;
  /** Imported images. OPT-IN. */
  images: boolean;
}

export function defaultBundleInclusions(): SupportBundleInclusions {
  return {
    jobLogs: true,
    errors: true,
    crashes: true,
    machineProfile: true,
    storage: true,
    correlation: true,
    gcode: false,
    projectFile: false,
    images: false,
  };
}

/**
 * Inputs to the assembler. Each subsystem hands its snapshot in a
 * shape it controls; the assembler stringifies + redacts. Optional
 * fields are skipped silently when missing — a user without a job
 * log shouldn't get a bundle that fails to assemble.
 */
export interface SupportBundleInputs {
  appInfo: {
    version: string;
    buildChannel: 'stable' | 'beta' | 'alpha' | 'dev';
    electron?: string;
    chromium?: string;
    node?: string;
  };
  systemInfo: {
    platform: string;
    arch: string;
    locale?: string;
    screen?: { width: number; height: number };
  };
  correlationIds: CorrelationIds;
  jobLogs?: unknown[];
  errors?: unknown[];
  crashes?: unknown[];
  machineProfile?: unknown;
  storage?: unknown;
  /** Compile fingerprints (T2-85) — last N. */
  compileMetadata?: unknown[];
  /** Last N preflight reports. */
  preflightReports?: unknown[];
  /** When the user opts in: raw G-code text by job ID. */
  gcodeByJobId?: Record<string, string>;
  /** When the user opts in: project file JSON. */
  projectFileJson?: unknown;
  /**
   * When the user opts in: array of image data (base64-encoded data
   * URI or similar). The assembler does NOT decode — it embeds the
   * representation the caller provides.
   */
  images?: Array<{ id: string; dataUri: string }>;
}

export interface SupportBundle {
  manifest: SupportBundleManifest;
  /**
   * Filename → file content. Always-on files are JSON; opt-in files
   * are JSON for project, plain text for G-code, and a pseudo-archive
   * stub for images (Phase-3 wiring will replace with a real nested
   * ZIP).
   */
  files: Record<string, string>;
}

const MAX_JOB_LOGS = 20;
const MAX_ERRORS = 100;
const MAX_CRASHES = 20;
const MAX_COMPILE_METADATA = 20;
const MAX_PREFLIGHT = 20;

export interface BuildSupportBundleArgs {
  inputs: SupportBundleInputs;
  inclusions?: Partial<SupportBundleInclusions>;
  redactionOptions?: RedactionOptions;
  /** Pre-built bundle id — typically a CorrelationId of kind 'bundle'. */
  bundleId: string;
  /** Override clock for tests; defaults to ISO of `new Date()`. */
  generatedAt?: string;
}

/**
 * Assemble the support bundle. Pure — no I/O, no ZIP creation. The
 * caller writes `bundle.files` to a ZIP archive; the assembler's
 * job is the redaction + inclusion-filtering + manifest-stamping.
 */
export function buildSupportBundle(args: BuildSupportBundleArgs): SupportBundle {
  const inclusions: SupportBundleInclusions = {
    ...defaultBundleInclusions(),
    ...(args.inclusions ?? {}),
  };
  const redaction: RedactionOptions = args.redactionOptions ?? {
    ...defaultRedactionOptions(),
    redactProjectNames: true,
  };
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  const manifest: SupportBundleManifest = {
    schemaVersion: 1,
    bundleId: args.bundleId,
    generatedAt,
    appVersion: args.inputs.appInfo.version,
    inclusions,
    redaction,
  };

  const files: Record<string, string> = {
    'manifest.json': stringify(manifest),
    'app-info.json': stringify(redactObject(args.inputs.appInfo, redaction)),
    'system-info.json': stringify(redactObject(args.inputs.systemInfo, redaction)),
  };

  if (inclusions.correlation) {
    files['correlation-ids.json'] = stringify(args.inputs.correlationIds);
  }

  if (inclusions.jobLogs && args.inputs.jobLogs) {
    files['recent-job-logs.json'] = stringify(
      redactObject(args.inputs.jobLogs.slice(-MAX_JOB_LOGS), redaction),
    );
  }

  if (inclusions.errors && args.inputs.errors) {
    files['recent-errors.json'] = stringify(
      redactObject(args.inputs.errors.slice(-MAX_ERRORS), redaction),
    );
  }

  if (inclusions.crashes && args.inputs.crashes) {
    files['recent-crashes.json'] = stringify(
      redactObject(args.inputs.crashes.slice(-MAX_CRASHES), redaction),
    );
  }

  if (inclusions.machineProfile && args.inputs.machineProfile !== undefined) {
    files['machine-profile-snapshot.json'] = stringify(
      redactObject(args.inputs.machineProfile, redaction),
    );
  }

  if (inclusions.storage && args.inputs.storage !== undefined) {
    files['storage-health.json'] = stringify(
      redactObject(args.inputs.storage, redaction),
    );
  }

  if (args.inputs.compileMetadata) {
    files['compile-metadata.json'] = stringify(
      redactObject(args.inputs.compileMetadata.slice(-MAX_COMPILE_METADATA), redaction),
    );
  }

  if (args.inputs.preflightReports) {
    files['preflight-reports.json'] = stringify(
      redactObject(args.inputs.preflightReports.slice(-MAX_PREFLIGHT), redaction),
    );
  }

  // ─── Opt-in inclusions ─────────────────────────────────────

  if (inclusions.gcode && args.inputs.gcodeByJobId) {
    for (const [jobId, text] of Object.entries(args.inputs.gcodeByJobId)) {
      // G-code lines are preserved (the user opted in to share them);
      // license keys in comments are still redacted by redactObject.
      const opts: RedactionOptions = { ...redaction, redactGcode: false };
      const redacted = redactObject(text, opts);
      files[`gcode-${jobId}.txt`] = String(redacted);
    }
  }

  if (inclusions.projectFile && args.inputs.projectFileJson !== undefined) {
    // The user opted to share the project, so we DON'T redact project
    // names inside the project file — but license keys still go.
    const opts: RedactionOptions = { ...redaction, redactProjectNames: false };
    const projectId = args.inputs.correlationIds.projectId ?? 'unknown';
    files[`project-${projectId}.lf`] = stringify(
      redactObject(args.inputs.projectFileJson, opts),
    );
  }

  if (inclusions.images && args.inputs.images && args.inputs.images.length > 0) {
    // Stub for Phase 3: a nested archive will replace this. For now,
    // record IDs + size for support.
    const summary = args.inputs.images.map((img) => ({
      id: img.id,
      bytes: img.dataUri.length,
    }));
    files['images-summary.json'] = stringify(summary);
  }

  return { manifest, files };
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Defensive scan: reads every file in a built bundle and returns
 * any that contain a license-key pattern. Should always return an
 * empty array — this is the test-time canary for the always-on
 * redaction contract.
 */
const LICENSE_KEY = /[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/i;

export function findLicenseKeyLeaks(bundle: SupportBundle): string[] {
  const leaks: string[] = [];
  for (const [name, content] of Object.entries(bundle.files)) {
    if (LICENSE_KEY.test(content)) leaks.push(name);
  }
  return leaks;
}

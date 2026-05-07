import {
  defaultRedactionOptions,
  redactObject,
  redactString,
  type RedactionOptions,
} from './Redaction';

export type CrashSource = 'renderer' | 'main';

export interface CrashReporterInput {
  message?: unknown;
  stack?: unknown;
  componentStack?: unknown;
  capturedAt?: unknown;
  projectName?: unknown;
  [key: string]: unknown;
}

export interface CrashReportPayload {
  schema: 'laserforge.crash.v1';
  source: CrashSource;
  appVersion: string;
  controllerType: string;
  os: string;
  reportedAt: string;
  report: unknown;
}

export type CrashReportResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'send-failed' };

export type CrashReportTransport = (
  payload: CrashReportPayload,
  dsn: string,
) => Promise<void>;

export interface CrashReporterOptions {
  dsn: string | null | undefined;
  appVersion: string;
  source: CrashSource;
  controllerType?: () => string;
  os?: () => string;
  now?: () => string;
  transport?: CrashReportTransport;
}

function crashRedactionOptions(): RedactionOptions {
  return {
    ...defaultRedactionOptions(),
    redactProjectNames: true,
    redactGcode: true,
    redactImages: true,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrubProjectName<T>(value: T, projectName: string | null): T {
  if (!projectName) return value;
  const pattern = new RegExp(escapeRegExp(projectName), 'g');
  return replaceStrings(value, (text) => text.replace(pattern, '[REDACTED:PROJECT_NAME]')) as T;
}

function replaceStrings(value: unknown, replacer: (text: string) => string): unknown {
  if (typeof value === 'string') return replacer(value);
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacer));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = replaceStrings(item, replacer);
  }
  return out;
}

function readProjectName(report: CrashReporterInput): string | null {
  return typeof report.projectName === 'string' && report.projectName.trim()
    ? report.projectName.trim()
    : null;
}

function defaultOs(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return nav?.userAgent || 'unknown';
}

async function defaultTransport(payload: CrashReportPayload, dsn: string): Promise<void> {
  if (typeof fetch !== 'function') throw new Error('fetch unavailable');
  const response = await fetch(dsn, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`crash report failed: ${response.status}`);
  }
}

export function buildCrashReportPayload(args: {
  source: CrashSource;
  appVersion: string;
  controllerType?: string;
  os?: string;
  report: unknown;
  reportedAt?: string;
}): CrashReportPayload {
  const options = crashRedactionOptions();
  const base = redactObject(args.report, options);
  const projectName = args.report != null && typeof args.report === 'object'
    ? readProjectName(args.report as CrashReporterInput)
    : null;
  const report = scrubProjectName(base, projectName);

  return {
    schema: 'laserforge.crash.v1',
    source: args.source,
    appVersion: redactString(args.appVersion, options),
    controllerType: redactString(args.controllerType ?? 'unknown', options),
    os: redactString(args.os ?? defaultOs(), options),
    reportedAt: args.reportedAt ?? new Date().toISOString(),
    report,
  };
}

// T3-6: opt-in crash reporter. No DSN means no network send.
export function createCrashReporter(options: CrashReporterOptions): {
  report: (report: unknown) => Promise<CrashReportResult>;
} {
  const transport = options.transport ?? defaultTransport;

  return {
    report: async (report: unknown): Promise<CrashReportResult> => {
      const dsn = options.dsn?.trim();
      if (!dsn) return { ok: false, reason: 'disabled' };

      const payload = buildCrashReportPayload({
        source: options.source,
        appVersion: options.appVersion,
        controllerType: options.controllerType?.() ?? 'unknown',
        os: options.os?.() ?? defaultOs(),
        report,
        reportedAt: options.now?.(),
      });

      try {
        await transport(payload, dsn);
        return { ok: true };
      } catch (err) {
        console.warn('[crash-report] send failed', err);
        return { ok: false, reason: 'send-failed' };
      }
    },
  };
}

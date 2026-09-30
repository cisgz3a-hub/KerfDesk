import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_LOG_BYTES = 16_384;
const bounded = (value, limit = 2048) => (typeof value === 'string' ? value.slice(-limit) : null);

function safeLog(value) {
  // A fresh smoke profile never receives credentials. Also redact credential
  // shapes if a future diagnostic accidentally includes one; never copy env.
  const text = (typeof value === 'string' ? value : '')
    .replace(/\bKD1[.-][A-Za-z0-9._-]+/gu, '[redacted licence key]')
    .replace(/("(?:licenseKey|activationToken|claimToken)"\s*:\s*")[^"]*(")/gu, '$1[redacted]$2')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]');
  const bytes = Buffer.from(text);
  return {
    bytes: bytes.subarray(Math.max(0, bytes.length - MAX_LOG_BYTES)),
    truncated: bytes.length > MAX_LOG_BYTES,
  };
}

const safeMessage = (value) => safeLog(value).bytes.toString('utf8').slice(-2048);

/** Optional, bounded diagnostics; omit raw smoke payloads, request bodies and environment. */
export function createIntegrityEvidence(output) {
  if (output === undefined) return { directory: null, record: () => undefined };
  const root = resolve(output);
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'run-'));
  return {
    directory,
    record(phase, observation, observerError = null) {
      if (!['baseline', 'tampered'].includes(phase)) throw new Error('Invalid integrity phase');
      const stdout = safeLog(observation?.stdout);
      const stderr = safeLog(observation?.stderr);
      const process =
        observation === null
          ? null
          : {
              code: observation.code ?? null,
              signal: bounded(observation.signal, 80),
              spawned: observation.spawned === true,
              childClosed: observation.childClosed === true,
              logsComplete: observation.logsComplete === true,
              failure:
                observation.failure === null || observation.failure === undefined
                  ? null
                  : {
                      kind: bounded(observation.failure.kind, 80),
                      message: safeMessage(observation.failure.message),
                    },
              errors: (Array.isArray(observation.errors) ? observation.errors : [])
                .slice(0, 10)
                .map(safeMessage),
            };
      const smoke = observation?.smokeResult;
      const metadata = {
        schemaVersion: 1,
        phase,
        recordedAt: new Date().toISOString(),
        process,
        observerError: observerError === null ? null : safeMessage(observerError.message),
        resultWritten: observation?.resultWritten === true,
        smokeSummary:
          smoke && typeof smoke === 'object'
            ? {
                ok: smoke.ok === true,
                failureCount: Array.isArray(smoke.failures) ? smoke.failures.length : null,
                failures: (Array.isArray(smoke.failures) ? smoke.failures : [])
                  .slice(0, 10)
                  .map(safeMessage),
                rendererReady: smoke.renderer?.readyToShow === true,
                imported: smoke.renderer?.imported === true,
                saved: smoke.renderer?.saved === true,
              }
            : null,
        logs: {
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          maxBytesPerLog: MAX_LOG_BYTES,
        },
      };
      writeFileSync(join(directory, `${phase}-stdout.txt`), stdout.bytes, { flag: 'wx' });
      writeFileSync(join(directory, `${phase}-stderr.txt`), stderr.bytes, { flag: 'wx' });
      writeFileSync(join(directory, `${phase}.json`), `${JSON.stringify(metadata, null, 2)}\n`, {
        flag: 'wx',
      });
    },
  };
}

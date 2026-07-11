// Classify a line received from a GRBL controller into a discriminated union.
// The streaming state machine pattern-matches on the kind to decide what to
// do (consume from the buffer, surface to UI, log, etc.).
//
// Response shapes (per GRBL v1.1 wiki):
//   ok                       Line accepted; consume from buffer.
//   error:N                  Line rejected; consume from buffer + surface.
//   ALARM:N                  Alarm fired; halt streaming + surface.
//   <…status…>               Real-time status report.
//   $N=value                 Settings line (response to $$).
//   [VER:…]                  Build version banner.
//   [MSG:…] / [HLP:…]        Informational messages.
//   Grbl 1.1h ['$' for help] Welcome banner.

import { parseStatusReport, type StatusReport } from './status-parser';
import { describeError } from './error-codes';

export type GrblResponse =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly code: number | null; readonly raw?: string }
  | { readonly kind: 'alarm'; readonly code: number }
  | { readonly kind: 'status'; readonly report: StatusReport }
  | { readonly kind: 'setting'; readonly id: number; readonly value: string }
  | { readonly kind: 'message'; readonly tag: string; readonly body: string }
  | { readonly kind: 'welcome'; readonly raw: string }
  | { readonly kind: 'unknown'; readonly raw: string };

const SETTING_RE = /^\$(\d+)=(.+)$/;
const MESSAGE_RE = /^\[([^:\]]+):([^\]]*)\]$/;
// Matches vanilla GRBL ("Grbl 1.1f [...]"), grblHAL ("GrblHAL 1.1f [...]"),
// and FluidNC ("Grbl 3.7 [FluidNC v3.7.x]") welcome banners; the family is
// disambiguated downstream by detectControllerFromBanner.
const WELCOME_RE = /^Grbl(?:HAL)? [\d.]+/i;

// Real GRBL/grblHAL error codes are 1-2 digits (vanilla GRBL tops out at 38;
// grblHAL's extended codes stay well under 100). We carry an undescribed
// numeric code up to this generous ceiling so the UI/log can show "Error N"
// and structured state keeps the number; multi-thousand values (e.g.
// error:7002009) are mis-framing/garbage, not firmware codes, and fall back
// to a raw-only, code:null event rather than a bogus "Error 7002009".
const MAX_PLAUSIBLE_ERROR_CODE = 999;

type Matcher = (line: string) => GrblResponse | null;

const MATCHERS: ReadonlyArray<Matcher> = [
  matchOk,
  matchError,
  matchCodedKeyword('ALARM:', (code) => ({ kind: 'alarm', code })),
  matchStatus,
  matchSetting,
  matchMessage,
  matchWelcome,
];

export function classifyResponse(line: string): GrblResponse {
  const trimmed = line.trim();
  for (const m of MATCHERS) {
    const r = m(trimmed);
    if (r !== null) return r;
  }
  return { kind: 'unknown', raw: trimmed };
}

function matchOk(line: string): GrblResponse | null {
  return line === 'ok' ? { kind: 'ok' } : null;
}

function matchError(line: string): GrblResponse | null {
  if (!line.startsWith('error:')) return null;
  const codeText = line.slice('error:'.length);
  if (!/^\d+$/.test(codeText)) return { kind: 'error', code: null, raw: line };
  const code = Number.parseInt(codeText, 10);
  if (code > MAX_PLAUSIBLE_ERROR_CODE) return { kind: 'error', code: null, raw: line };
  // Undescribed grblHAL codes (39+) keep their number AND raw line so "Error N"
  // surfaces downstream; described codes stay code-only (unchanged shape).
  return describeError(code) === null
    ? { kind: 'error', code, raw: line }
    : { kind: 'error', code };
}

function matchCodedKeyword(prefix: string, build: (code: number) => GrblResponse): Matcher {
  return (line) => {
    if (!line.startsWith(prefix)) return null;
    const codeText = line.slice(prefix.length);
    if (!/^\d+$/.test(codeText)) return null;
    return build(Number.parseInt(codeText, 10));
  };
}

function matchStatus(line: string): GrblResponse | null {
  if (!line.startsWith('<')) return null;
  const report = parseStatusReport(line);
  return report === null ? null : { kind: 'status', report };
}

function matchSetting(line: string): GrblResponse | null {
  const m = SETTING_RE.exec(line);
  if (m === null) return null;
  const id = Number.parseInt(m[1] ?? '', 10);
  return Number.isFinite(id) ? { kind: 'setting', id, value: m[2] ?? '' } : null;
}

function matchMessage(line: string): GrblResponse | null {
  const m = MESSAGE_RE.exec(line);
  return m === null ? null : { kind: 'message', tag: m[1] ?? '', body: m[2] ?? '' };
}

function matchWelcome(line: string): GrblResponse | null {
  return WELCOME_RE.test(line) ? { kind: 'welcome', raw: line } : null;
}

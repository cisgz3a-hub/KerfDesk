// Fail-closed parsing of main's desktop project routes (ADR-378). Anything
// malformed is dropped, never guessed at.

import type { RecentFileProbe, RecentFileRef } from '../types';

type DesktopPathRef = Extract<RecentFileRef, { kind: 'desktop-path' }>;
type UnavailableReason = 'missing' | 'invalid' | 'unreadable';

export type DesktopOpenRequest =
  | { readonly kind: 'file'; readonly ref: DesktopPathRef; readonly size: number }
  | { readonly kind: 'unavailable'; readonly name: string; readonly reason: UnavailableReason };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_PATH_LENGTH = 32_767;
const MAX_NAME_LENGTH = 1_024;
const MAX_REQUESTS = 16;
const REASONS: ReadonlyArray<UnavailableReason> = ['missing', 'invalid', 'unreadable'];

export function parseDesktopOpenRequests(value: unknown): ReadonlyArray<DesktopOpenRequest> {
  if (!isRecord(value) || !Array.isArray(value['requests'])) return [];
  return value['requests']
    .slice(0, MAX_REQUESTS)
    .map(parseOpenRequest)
    .filter((request): request is DesktopOpenRequest => request !== null);
}

export function parseDesktopProbe(value: unknown): RecentFileProbe {
  if (!isRecord(value)) return { kind: 'unknown' };
  if (value['kind'] === 'missing') return { kind: 'missing' };
  const size = value['size'];
  const modifiedMs = value['modifiedMs'];
  if (value['kind'] !== 'present' || !isByteCount(size) || !isTime(modifiedMs)) {
    return { kind: 'unknown' };
  }
  return { kind: 'present', size, modifiedMs };
}

function parseOpenRequest(value: unknown): DesktopOpenRequest | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'unavailable') {
    const name = value['name'];
    const reason = REASONS.find((candidate) => candidate === value['reason']);
    return isName(name) && reason !== undefined ? { kind: 'unavailable', name, reason } : null;
  }
  const path = value['path'];
  const token = value['token'];
  const size = value['size'];
  if (value['kind'] !== 'file' || !isPath(path) || !isByteCount(size)) return null;
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  return { kind: 'file', ref: { kind: 'desktop-path', path, token }, size };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0')
  );
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

import { Sha256State } from '../../core/relief/sha256';
import {
  hasProjectSeal,
  splitProjectSeal,
  withProjectSeal,
} from '../../io/project/project-device-seal';

// Device seals for projects saved on this computer (ADR-592). A commercial
// desktop build's main process keeps one random key per computer, protected by
// the operating system, and gives it only to this renderer. Saving seals the
// project text; a Free session opens Pro work only from text sealed here, so a
// shared or hand-edited project cannot carry Pro operations into Free.

const encoder = new TextEncoder();
const DOMAIN = encoder.encode('kerfdesk-project-seal:v1:');
const BLOCK = 64;

let key: Uint8Array | null = null;
let ready: Promise<void> = Promise.resolve();
const trusted = new WeakSet<object>();

/** Starts loading this computer's seal key; builds without one never seal. */
export function installProjectSealKey(load: () => Promise<string | null>): void {
  ready = load()
    .then((value) => {
      key = decodeKey(value);
    })
    .catch(() => {
      key = null;
    });
}

/** Resolves once the key has loaded or is known to be unavailable. */
export function projectSealReady(): Promise<void> {
  return ready;
}

/** Project text with this computer's seal appended; unchanged without a key or when sealed. */
export function sealProjectText(text: string): string {
  return key === null || hasProjectSeal(text) ? text : withProjectSeal(text, sealFor(key, text));
}

/** The loaded key, passed to an autosave worker so large text is hashed off the canvas thread. */
export function currentProjectSealKey(): string | null {
  return key === null ? null : base64url(key);
}

/** Uses a key received from the window; for workers, which cannot load one themselves. */
export function adoptProjectSealKey(value: string | null): void {
  key = decodeKey(value);
}

/** True only for project text this computer sealed and nobody changed since. */
export function projectTextSealedHere(text: string): boolean {
  if (key === null) return false;
  const { body, seal } = splitProjectSeal(text);
  return seal !== null && sameText(seal, sealFor(key, body));
}

/** Marks a project as admitted: sealed here, or derived from the open document. */
export function trustProject<T extends object>(project: T): T {
  trusted.add(project);
  return project;
}

export function isTrustedProject(project: object): boolean {
  return trusted.has(project);
}

/** Trusts `project` when `text`, the text it was read from, was sealed here. */
export function trustIfSealedHere(project: object, text: string): boolean {
  if (!projectTextSealedHere(text)) return false;
  trustProject(project);
  return true;
}

export function resetProjectSealForTests(value: string | null = null): void {
  key = decodeKey(value);
  ready = Promise.resolve();
}

function decodeKey(value: string | null): Uint8Array | null {
  if (value === null || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sealFor(secret: Uint8Array, body: string): string {
  return base64url(hmacSha256(secret, [DOMAIN, encoder.encode(body)]));
}

/** HMAC-SHA256 (RFC 2104) over byte parts, synchronously, for a key of at most 64 bytes. */
function hmacSha256(secret: Uint8Array, parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const padded = new Uint8Array(BLOCK);
  padded.set(secret);
  const inner = new Sha256State();
  inner.update(padded.map((byte) => byte ^ 0x36));
  for (const part of parts) inner.update(part);
  const outer = new Sha256State();
  outer.update(padded.map((byte) => byte ^ 0x5c));
  outer.update(hexBytes(inner.finishHex()));
  return hexBytes(outer.finishHex());
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

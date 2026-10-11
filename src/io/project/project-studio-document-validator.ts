import { isObject } from './project-shape-primitives';
import { visitWorkflowArchives } from './project-workflow-archives';

export const MAX_STUDIO_DOCUMENTS = 64;
export const MAX_STUDIO_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_PROJECT_STUDIO_BYTES = 64 * 1024 * 1024;

/** Includes archived sheets/variants in the single project's native-source budget. */
export function validateProjectStudioDocuments(project: Record<string, unknown>): string | null {
  let total = 0;
  let error: string | null = null;
  const check = (raw: Record<string, unknown>): void => {
    if (error !== null) return;
    error = validateStudioDocuments(raw['studioDocuments']);
    if (error !== null || !Array.isArray(raw['studioDocuments'])) return;
    for (const document of raw['studioDocuments'])
      total += decodedLength((document as { nativeBase64: string }).nativeBase64);
    if (total > MAX_PROJECT_STUDIO_BYTES)
      error = 'Project studio documents exceed the 64 MiB native-source budget';
  };
  check(project);
  return error ?? visitWorkflowArchives(project, check) ?? error;
}

export function validateStudioDocuments(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_STUDIO_DOCUMENTS)
    return `studioDocuments must contain at most ${MAX_STUDIO_DOCUMENTS} documents`;
  const ids = new Set<string>();
  let total = 0;
  for (const document of value) {
    const error = validateStudioDocument(document);
    if (error !== null) return error;
    const entry = document as { id: string; nativeBase64: string };
    if (ids.has(entry.id)) return 'studioDocuments contains a duplicate document id';
    ids.add(entry.id);
    total += decodedLength(entry.nativeBase64);
  }
  return total > MAX_PROJECT_STUDIO_BYTES
    ? 'Project studio documents exceed the 64 MiB native-source budget'
    : null;
}

function validateStudioDocument(value: unknown): string | null {
  if (!isObject(value)) return 'Invalid studio document';
  if (!documentId(value['id']) || !identifier(value['revision']))
    return 'Invalid studio document id or revision';
  if (!text(value['title'], 240) || !text(value['editorVersion'], 64))
    return 'Invalid studio document title or editor version';
  const format = value['editor'] === 'photo' ? 'pcraft' : 'vectorcraft';
  if (!['photo', 'vector'].includes(String(value['editor'])) || value['nativeFormat'] !== format)
    return 'Studio document editor and native format do not match';
  if (typeof value['nativeSha256'] !== 'string' || !/^[a-f0-9]{64}$/.test(value['nativeSha256']))
    return 'Invalid studio document SHA-256';
  if (!canonicalNativeBase64(value['nativeBase64']))
    return 'Invalid studio document nativeBase64 or native document exceeds 32 MiB';
  return null;
}

function documentId(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

function identifier(value: unknown): boolean {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function text(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function decodedLength(value: string): number {
  return (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

function canonicalNativeBase64(value: unknown): boolean {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0) return false;
  if (decodedLength(value) > MAX_STUDIO_DOCUMENT_BYTES) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  // Reject nonzero padding bits without decoding/copying a potentially large native file.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (value.endsWith('==')) return (alphabet.indexOf(value.charAt(value.length - 3)) & 15) === 0;
  if (value.endsWith('=')) return (alphabet.indexOf(value.charAt(value.length - 2)) & 3) === 0;
  return true;
}

import { createHash } from 'node:crypto';
import { ARTCRAFT_VERSIONS } from './artcraft-installation.js';
import { record, type ArtcraftDocument, type ArtcraftEditor } from './artcraft-types.js';

/** Revalidate portable source at the native boundary, including its actual digest. */
export function readArtcraftDocument(value: unknown): {
  document: ArtcraftDocument;
  bytes: Buffer;
} {
  const item = record(value);
  const editor = item['editor'];
  if (editor !== 'photo' && editor !== 'vector') throw new Error('Unknown document editor');
  validateMetadata(item, editor);
  const bytes = decodeSource(item['nativeBase64']);
  if (
    typeof item['nativeSha256'] !== 'string' ||
    createHash('sha256').update(bytes).digest('hex') !== item['nativeSha256']
  )
    throw new Error('Native document checksum does not match');
  return { document: item as unknown as ArtcraftDocument, bytes };
}
function validateMetadata(item: Record<string, unknown>, editor: ArtcraftEditor): void {
  if (
    typeof item['id'] !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item['id'])
  )
    throw new Error('Invalid studio document id');
  for (const key of ['title', 'revision', 'editorVersion'] as const)
    if (typeof item[key] !== 'string' || item[key].length === 0 || item[key].length > 240)
      throw new Error('Invalid studio document metadata');
  if (item['editorVersion'] !== ARTCRAFT_VERSIONS[editor])
    throw new Error(
      'This document needs a different editor version. Keep its original project file.',
    );
  if (item['nativeFormat'] !== (editor === 'photo' ? 'pcraft' : 'vectorcraft'))
    throw new Error('Wrong native document format');
}
function decodeSource(source: unknown): Buffer {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.length > 44_739_244 ||
    source.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(source)
  )
    throw new Error('Invalid native document bytes');
  const bytes = Buffer.from(source, 'base64');
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024 || bytes.toString('base64') !== source)
    throw new Error('Invalid native document encoding');
  return bytes;
}

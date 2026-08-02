import {
  createDxfEntityCollector,
  createDxfMetadataCollector,
  createDxfSectionNameScanner,
  type DxfMetadata,
} from '../../io/dxf/dxf-document-stream';
import { createDxfTagLineParser } from '../../io/dxf/dxf-tag-line-parser';
import type { DxfTag } from '../../io/dxf/dxf-tags';
import type { ParseDxfResult } from '../../io/dxf';
import { readBlobLines, type BlobReadProgress } from './blob-line-reader';

type DxfParseError = Extract<ParseDxfResult, { kind: 'error' }>;

// What a pass decides after seeing one tag: keep reading, or abandon the rest of
// the file because everything this pass wanted has already gone by.
type TagOutcome = 'continue' | 'stop';

type MetadataPassOutcome =
  | { readonly kind: 'error'; readonly error: DxfParseError }
  | { readonly kind: 'ok'; readonly metadata: DxfMetadata };

type EntityPassOutcome =
  | { readonly kind: 'error'; readonly error: DxfParseError }
  | { readonly kind: 'ok'; readonly result: ParseDxfResult; readonly hasLateMetadata: boolean };

type MetadataPassScope = 'until-entities' | 'whole-file';

type PassProgress = {
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly report: ((progress: BlobReadProgress) => void) | undefined;
};

const ENTITIES_SECTION = 'ENTITIES';
const METADATA_SECTIONS: ReadonlySet<string> = new Set(['HEADER', 'TABLES', 'BLOCKS']);
const PASS_COUNT = 2;

export async function parseDxfBlob(
  blob: Blob,
  args: { readonly id: string; readonly source: string },
  onProgress?: (progress: BlobReadProgress) => void,
): Promise<ParseDxfResult> {
  const totalBytes = blob.size * PASS_COUNT;
  const first = await runMetadataPass(blob, 'until-entities', {
    completedBytes: 0,
    totalBytes,
    report: onProgress,
  });
  if (first.kind === 'error') return first.error;

  const entities = await runEntityPass(blob, first.metadata, args, {
    completedBytes: blob.size,
    totalBytes,
    report: onProgress,
  });
  if (entities.kind === 'error') return entities.error;
  if (!entities.hasLateMetadata) return entities.result;

  // DXF does not require HEADER/TABLES/BLOCKS to precede ENTITIES, and the
  // shortened first pass never saw what followed. Redo both passes over the
  // whole file. Progress stays silent because it already reported completion —
  // better than rewinding the operator's bar on a rare file layout.
  const silent: PassProgress = { completedBytes: 0, totalBytes, report: undefined };
  const full = await runMetadataPass(blob, 'whole-file', silent);
  if (full.kind === 'error') return full.error;
  const replayed = await runEntityPass(blob, full.metadata, args, silent);
  return replayed.kind === 'error' ? replayed.error : replayed.result;
}

async function runMetadataPass(
  blob: Blob,
  scope: MetadataPassScope,
  progress: PassProgress,
): Promise<MetadataPassOutcome> {
  const collector = createDxfMetadataCollector();
  let outcome: TagOutcome = 'continue';
  // The entity list is the bulk of a real DXF and holds nothing this pass wants,
  // so reading stops the moment its section header lands.
  const scanner = createDxfSectionNameScanner((name) => {
    if (scope === 'until-entities' && name === ENTITIES_SECTION) outcome = 'stop';
  });
  const error = await runPass(blob, progress, (tag) => {
    collector.pushTag(tag);
    scanner(tag);
    return outcome;
  });
  return error === null ? { kind: 'ok', metadata: collector.finish() } : { kind: 'error', error };
}

async function runEntityPass(
  blob: Blob,
  metadata: DxfMetadata,
  args: { readonly id: string; readonly source: string },
  progress: PassProgress,
): Promise<EntityPassOutcome> {
  const collector = createDxfEntityCollector(metadata, args);
  let hasSeenEntities = false;
  let hasLateMetadata = false;
  const scanner = createDxfSectionNameScanner((name) => {
    if (name === ENTITIES_SECTION) hasSeenEntities = true;
    else if (hasSeenEntities && METADATA_SECTIONS.has(name)) hasLateMetadata = true;
  });
  const error = await runPass(blob, progress, (tag) => {
    collector.pushTag(tag);
    scanner(tag);
    return 'continue';
  });
  return error === null
    ? { kind: 'ok', result: collector.finish(), hasLateMetadata }
    : { kind: 'error', error };
}

async function runPass(
  blob: Blob,
  progress: PassProgress,
  onTag: (tag: DxfTag) => TagOutcome,
): Promise<DxfParseError | null> {
  let isStopRequested = false;
  const parser = createDxfTagLineParser((tag) => {
    if (onTag(tag) === 'stop') isStopRequested = true;
  });
  await readBlobLines(
    blob,
    (line, control) => {
      parser.pushLine(line);
      if (isStopRequested) control.stop();
    },
    ({ bytesRead }) => {
      progress.report?.({
        bytesRead: progress.completedBytes + bytesRead,
        totalBytes: progress.totalBytes,
      });
    },
  );
  const result = parser.finish();
  return result.kind === 'error' ? result : null;
}

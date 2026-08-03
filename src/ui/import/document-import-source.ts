import { parseSvgWorkerDocument, readSvgDocumentFromBlob } from '../../io/svg';
import {
  readXmlDocumentFromBlob,
  XmlActiveDeclarationError,
  XmlDocumentParseError,
} from '../../io/xml';
import { parseDocumentImportText } from './document-import-parse';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

// Streaming-tokenizer point for .lf2 project JSON.
//
// The incremental tokenizer (src/io/json) walks the file one character at a
// time through a JS state machine so a very large project never exists as one
// decoded string. Native JSON.parse needs the whole text in memory first but
// runs entirely in engine code. Below this size the memory the streaming path
// saves is not worth paying per-character JS dispatch on every ordinary file
// open, so decode once and use the same deserializeProject path the no-stream
// compatibility branch already takes.
//
// The value matches the other 25 MiB import boundaries in the tree
// (PAGED_PNG_MIN_BYTES, LARGE_IMPORT_ADVISORY_BYTES) but stays its own
// constant: this one is a parser-selection tradeoff, not a persistence-schema
// boundary or a UX advisory, and may move independently of them.
export const PROJECT_NATIVE_JSON_PARSE_MAX_BYTES = 25 * 1024 * 1024;

export async function parseDocumentImportSource(
  request: DocumentImportWorkerRequest,
  onParsing: () => void,
): Promise<DocumentImportWorkerResponse> {
  if (request.kind === 'project' && shouldStreamProjectJson(request.blob)) {
    const [{ readJsonValueFromBlob, StreamedJsonSyntaxError }, { deserializeProjectValue }] =
      await Promise.all([import('../../io/json'), import('../../io/project')]);
    let raw: unknown;
    try {
      raw = await readJsonValueFromBlob(request.blob);
    } catch (error) {
      if (!(error instanceof StreamedJsonSyntaxError)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        kind: request.kind,
        result: { kind: 'invalid', reason: `not valid JSON: ${message}` },
      };
    }
    onParsing();
    return { id: request.id, kind: request.kind, result: deserializeProjectValue(raw) };
  }

  if (request.kind === 'svg' && typeof request.blob.stream === 'function') {
    const document = await readSvgDocumentFromBlob(request.blob);
    onParsing();
    return {
      id: request.id,
      kind: request.kind,
      result: parseSvgWorkerDocument(document, {
        id: request.objectId,
        source: request.source,
      }),
    };
  }
  if (
    (request.kind === 'lightburn-project' || request.kind === 'lightburn-clb') &&
    typeof request.blob.stream === 'function'
  ) {
    return parseLightBurnDocumentSource(request, onParsing);
  }

  const text = await request.blob.text();
  onParsing();
  return parseDocumentImportText(request, text);
}

/**
 * True when a project blob is big enough that holding its whole decoded text in
 * memory is the real cost, which is the case the incremental tokenizer exists for.
 */
function shouldStreamProjectJson(blob: Blob): boolean {
  return typeof blob.stream === 'function' && blob.size >= PROJECT_NATIVE_JSON_PARSE_MAX_BYTES;
}

type LightBurnDocumentRequest = Extract<
  DocumentImportWorkerRequest,
  { readonly kind: 'lightburn-project' | 'lightburn-clb' }
>;

async function parseLightBurnDocumentSource(
  request: LightBurnDocumentRequest,
  onParsing: () => void,
): Promise<DocumentImportWorkerResponse> {
  let document: Document;
  try {
    document = await readXmlDocumentFromBlob(request.blob, {
      label: request.kind === 'lightburn-project' ? 'LightBurn project' : 'CLB',
      mediaType: 'text/xml',
      forbidActiveDeclarations: true,
    });
  } catch (error) {
    if (error instanceof XmlActiveDeclarationError) {
      if (request.kind === 'lightburn-project' && !/\.lbrn2?$/i.test(request.source)) {
        return lightBurnFailure(request, 'Expected a .lbrn or .lbrn2 project.');
      }
      return lightBurnFailure(
        request,
        request.kind === 'lightburn-project'
          ? 'Active XML declarations are not allowed.'
          : 'CLB active XML declarations are not allowed.',
      );
    }
    if (error instanceof XmlDocumentParseError) {
      return lightBurnFailure(
        request,
        request.kind === 'lightburn-project'
          ? 'File is not a valid LightBurn project XML document.'
          : 'CLB file is not valid XML.',
      );
    }
    throw error;
  }

  onParsing();
  if (request.kind === 'lightburn-project') {
    const { importLightBurnProjectDocument } = await import('../../io/lightburn/lbrn-import');
    return {
      id: request.id,
      kind: request.kind,
      result: importLightBurnProjectDocument(document, request.source),
    };
  }
  const { importLightBurnClbDocument } = await import('../../io/lightburn/clb-import');
  return {
    id: request.id,
    kind: request.kind,
    result: importLightBurnClbDocument(document, request.source),
  };
}

function lightBurnFailure(
  request: LightBurnDocumentRequest,
  reason: string,
): DocumentImportWorkerResponse {
  return { id: request.id, kind: request.kind, result: { ok: false, reason } };
}

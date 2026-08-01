import { parseSvgWorkerDocument, readSvgDocumentFromBlob } from '../../io/svg';
import { parseDocumentImportText } from './document-import-parse';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

export async function parseDocumentImportSource(
  request: DocumentImportWorkerRequest,
  onParsing: () => void,
): Promise<DocumentImportWorkerResponse> {
  if (request.kind === 'project' && typeof request.blob.stream === 'function') {
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

  const text = await request.blob.text();
  onParsing();
  return parseDocumentImportText(request, text);
}

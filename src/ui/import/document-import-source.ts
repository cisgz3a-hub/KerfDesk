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

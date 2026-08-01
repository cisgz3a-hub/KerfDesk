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

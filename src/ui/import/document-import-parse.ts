import { SaxesParser } from 'saxes';
import type { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { parseSvgInWorker } from '../../io/svg/parse-svg-worker';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

type WorkerDomParserConstructor = typeof WorkerDomParser;

export async function parseDocumentImportText(
  request: DocumentImportWorkerRequest,
  text: string,
): Promise<DocumentImportWorkerResponse> {
  if (request.kind === 'project') {
    const { deserializeProject } = await import('../../io/project/deserialize-project');
    return { id: request.id, kind: request.kind, result: deserializeProject(text) };
  }
  if (request.kind === 'svg') {
    assertWellFormedXml(text, 'SVG');
    return {
      id: request.id,
      kind: request.kind,
      result: parseSvgInWorker({
        svgText: text,
        id: request.objectId,
        source: request.source,
      }),
    };
  }
  if (request.kind === 'lightburn-project') {
    const [{ DOMParser }, { importLightBurnProject }] = await Promise.all([
      import('linkedom/worker'),
      import('../../io/lightburn/lbrn-import'),
    ]);
    if (!isWellFormedXml(text)) {
      return {
        id: request.id,
        kind: request.kind,
        result: { ok: false, reason: 'File is not a valid LightBurn project XML document.' },
      };
    }
    return {
      id: request.id,
      kind: request.kind,
      result: importLightBurnProject(text, request.source, (xml) => parseXml(xml, DOMParser)),
    };
  }
  if (request.kind === 'material-library') {
    const { deserializeMaterialLibrary } =
      await import('../../io/material-library/material-library-io');
    return { id: request.id, kind: request.kind, result: deserializeMaterialLibrary(text) };
  }
  const [{ DOMParser }, { importLightBurnClb }] = await Promise.all([
    import('linkedom/worker'),
    import('../../io/lightburn/clb-import'),
  ]);
  if (!isWellFormedXml(text)) {
    return {
      id: request.id,
      kind: request.kind,
      result: { ok: false, reason: 'CLB file is not valid XML.' },
    };
  }
  return {
    id: request.id,
    kind: request.kind,
    result: importLightBurnClb(text, request.source, (xml) => parseXml(xml, DOMParser)),
  };
}

function assertWellFormedXml(text: string, label: string): void {
  try {
    new SaxesParser().write(text).close();
  } catch (error) {
    throw new Error(
      `${label} parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isWellFormedXml(text: string): boolean {
  try {
    new SaxesParser().write(text).close();
    return true;
  } catch {
    return false;
  }
}

function parseXml(text: string, DOMParser: WorkerDomParserConstructor): Document {
  return new DOMParser().parseFromString(text, 'text/xml') as unknown as Document;
}

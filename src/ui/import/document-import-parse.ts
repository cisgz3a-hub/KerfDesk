import { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { SaxesParser } from 'saxes';
import { deserializeProject } from '../../io/project';
import { parseSvgInWorker } from '../../io/svg/parse-svg-worker';
import { importLightBurnClb, importLightBurnProject } from '../../io/lightburn';
import { deserializeMaterialLibrary } from '../../io/material-library';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

export function parseDocumentImportText(
  request: DocumentImportWorkerRequest,
  text: string,
): DocumentImportWorkerResponse {
  if (request.kind === 'project') {
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
      result: importLightBurnProject(text, request.source, parseXml),
    };
  }
  if (request.kind === 'material-library') {
    return { id: request.id, kind: request.kind, result: deserializeMaterialLibrary(text) };
  }
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
    result: importLightBurnClb(text, request.source, parseXml),
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

function parseXml(text: string): Document {
  return new WorkerDomParser().parseFromString(text, 'text/xml') as unknown as Document;
}

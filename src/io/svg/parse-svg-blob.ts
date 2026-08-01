import { readXmlDocumentFromBlob } from '../xml';

export async function readSvgDocumentFromBlob(blob: Blob): Promise<Document> {
  return readXmlDocumentFromBlob(blob, { label: 'SVG', mediaType: 'image/svg+xml' });
}

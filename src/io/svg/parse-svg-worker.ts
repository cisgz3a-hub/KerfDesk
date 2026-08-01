import { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { parseSvgDocument, type ParseSvgResult } from './parse-svg';
import type { SvgStripCounts } from './sanitize';

const SAFE_SVG_TAGS = new Set([
  'a',
  'circle',
  'clippath',
  'defs',
  'desc',
  'ellipse',
  'filter',
  'g',
  'image',
  'line',
  'lineargradient',
  'marker',
  'mask',
  'metadata',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialgradient',
  'rect',
  'stop',
  'style',
  'svg',
  'switch',
  'symbol',
  'text',
  'title',
  'tspan',
  'use',
]);
const DATA_IMAGE_URL = /^data:image\//i;

export function parseSvgInWorker(args: {
  readonly svgText: string;
  readonly id: string;
  readonly source: string;
}): ParseSvgResult {
  const document = new WorkerDomParser().parseFromString(
    args.svgText,
    'image/svg+xml',
  ) as unknown as Document;
  const stripped = sanitizeWorkerSvgDocument(document);
  return parseSvgDocument(document, args, stripped);
}

function sanitizeWorkerSvgDocument(document: Document): SvgStripCounts {
  const counts = {
    scripts: 0,
    foreignObjects: 0,
    externalLinks: 0,
    dataUris: 0,
  };
  for (const element of [...document.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'script') counts.scripts += 1;
    if (tag === 'foreignobject') counts.foreignObjects += 1;
    if (!SAFE_SVG_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    sanitizeAttributes(element, counts);
  }
  return counts;
}

function sanitizeAttributes(
  element: Element,
  counts: { externalLinks: number; dataUris: number },
): void {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on')) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name !== 'href' && name !== 'xlink:href') continue;
    const value = attribute.value.trim();
    if (value === '' || value.startsWith('#') || DATA_IMAGE_URL.test(value)) continue;
    if (value.toLowerCase().startsWith('data:')) counts.dataUris += 1;
    else counts.externalLinks += 1;
    element.removeAttribute(attribute.name);
  }
}

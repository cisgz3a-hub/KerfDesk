import { describe, expect, it } from 'vitest';
import { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';

const LEGACY_C1_REPLACEMENT = '\u2026';
const XML_C1_CODE_POINT = '\u0085';

type ReferenceCase = {
  readonly label: string;
  readonly entity: string;
  readonly entityIn: 'id' | 'href';
  readonly literal: string;
  readonly expectedPolylines: number;
};

const referenceCases: readonly ReferenceCase[] = ['&#x85;', '&#133;'].flatMap((entity) =>
  (['id', 'href'] as const).flatMap((entityIn) => [
    {
      label: `${entity} in ${entityIn} with the established replacement literal`,
      entity,
      entityIn,
      literal: LEGACY_C1_REPLACEMENT,
      expectedPolylines: 1,
    },
    {
      label: `${entity} in ${entityIn} with the XML code-point literal`,
      entity,
      entityIn,
      literal: XML_C1_CODE_POINT,
      expectedPolylines: 0,
    },
  ]),
);

describe('readSvgDocumentFromBlob', () => {
  it.each(referenceCases)('preserves worker geometry for $label', async (testCase) => {
    const svgText = referenceSvg(testCase);
    const args = { id: 'entity-reference', source: 'entity-reference.svg' };
    const established = parseSvgInWorker({ svgText, ...args });
    const streamedDocument = await readSvgDocumentFromBlob(oneByteChunkBlob(svgText));
    const streamed = parseSvgWorkerDocument(streamedDocument, args);

    expect(polylineCount(established)).toBe(testCase.expectedPolylines);
    expect(streamed).toEqual(established);
  });

  it.each([
    ['predefined entity', 'data-value', 'x&amp;y'],
    ['numeric greater-than reference', 'data-value', 'x&#62;y'],
    ['numeric non-breaking-space reference', 'data-value', 'x&#160;y'],
    ['ancestor-scoped xlink attribute', 'xlink:href', '#a&#x85;b'],
  ])('keeps linkedom attribute decoding for %s', async (_label, attribute, value) => {
    const svgText =
      attribute === 'xlink:href'
        ? `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use ${attribute}="${value}"/></svg>`
        : `<svg ${attribute}="${value}"/>`;
    // linkedom's worker document is structurally the DOM Document consumed by the SVG parser.
    const established = new WorkerDomParser().parseFromString(
      svgText,
      'image/svg+xml',
    ) as unknown as Document;
    const streamed = await readSvgDocumentFromBlob(oneByteChunkBlob(svgText));
    const establishedElement =
      attribute === 'xlink:href' ? established.querySelector('use') : established.documentElement;
    const streamedElement =
      attribute === 'xlink:href' ? streamed.querySelector('use') : streamed.documentElement;

    expect(establishedElement).not.toBeNull();
    expect(streamedElement).not.toBeNull();
    expect(streamedElement?.getAttribute(attribute)).toBe(
      establishedElement?.getAttribute(attribute),
    );
  });
});

function referenceSvg(testCase: ReferenceCase): string {
  const idPart = testCase.entityIn === 'id' ? testCase.entity : testCase.literal;
  const hrefPart = testCase.entityIn === 'href' ? testCase.entity : testCase.literal;
  return `<svg viewBox="0 0 10 10">
    <defs><path id="a${idPart}b" d="M0 0 L9 9"/></defs>
    <use href="#a${hrefPart}b" stroke="red"/>
  </svg>`;
}

function polylineCount(result: ReturnType<typeof parseSvgInWorker>): number {
  return result.object?.paths.reduce((sum, path) => sum + path.polylines.length, 0) ?? 0;
}

function oneByteChunkBlob(text: string): Blob {
  const bytes = new TextEncoder().encode(text);
  // The parser reads only size and stream; this double deliberately omits unrelated Blob methods.
  return {
    size: bytes.byteLength,
    stream: () => {
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index >= bytes.byteLength) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(index, index + 1));
          index += 1;
        },
      });
    },
  } as Blob;
}

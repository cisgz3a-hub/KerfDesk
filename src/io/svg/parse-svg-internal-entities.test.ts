import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

// Legacy Illustrator "Save As SVG" layout: namespace URIs and, with the
// "Entity References" CSS option, styles declared as internal-subset entities.
const ILLUSTRATOR = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">
\t<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
\t<!ENTITY st0 "fill:none;stroke:#0000FF;">
]>
<svg version="1.1" xmlns:i="&ns_ai;" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="200px" height="100px" viewBox="0 0 200 100">
<rect x="10" y="10" width="50" height="50" style="&st0;"/>
</svg>`;

const identity = { id: 'entities', source: 'entities.svg' };
const parsers: readonly (readonly [string, (text: string) => Promise<ParseSvgResult>])[] = [
  ['browser fallback', async (svgText) => parseSvg({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

describe.each(parsers)('internal-subset entities through %s', (_name, parse) => {
  it('imports artwork whose namespaces and styles are entity references', async () => {
    const result = await parse(ILLUSTRATOR);
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#0000ff']);
    expect(result.fragment?.entries[0]).toMatchObject({ operationOverride: { mode: 'line' } });
  });
});

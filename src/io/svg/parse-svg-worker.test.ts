import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';
import { parseSvgInWorker } from './parse-svg-worker';

const clean = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
  <defs><path id="p" d="M0 0 L5 0"/></defs>
  <use href="#p" x="2" y="3" stroke="#f00"/>
  <rect x="10" y="2" width="4" height="5" fill="#00f"/>
</svg>`;

describe('parseSvgInWorker', () => {
  it('matches the native sanitized parser for supported geometry', () => {
    const args = { svgText: clean, id: 'worker', source: 'worker.svg' };
    expect(parseSvgInWorker(args)).toEqual(parseSvg(args));
  });

  it('removes active elements, event handlers, and non-local hrefs before geometry parsing', () => {
    const result = parseSvgInWorker({
      svgText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <script><path d="M0 0 L9 9"/></script>
        <foreignObject><path d="M0 0 L9 9"/></foreignObject>
        <use href="javascript:alert(1)" onload="alert(2)"/>
        <path d="M0 0 L1 1" stroke="black"/>
      </svg>`,
      id: 'malicious',
      source: 'malicious.svg',
    });

    expect(result.stripped).toEqual({
      scripts: 1,
      foreignObjects: 1,
      externalLinks: 1,
      dataUris: 0,
    });
    expect(result.object?.paths.flatMap((path) => path.polylines)).toHaveLength(1);
  });
});

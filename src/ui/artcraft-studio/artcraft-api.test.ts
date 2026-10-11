import { expect, it } from 'vitest';
import { parseSvg } from '../../io/svg';
import { vectorSnapshotSource, type StudioSnapshot } from './artcraft-api';

const snapshot: StudioSnapshot = {
  id: 'session-1',
  editor: 'vector',
  nativeSaved: true,
  revision: '1',
  filename: 'art.svg',
  mime: 'image/svg+xml',
  dataBase64: '',
  widthMm: 120,
  heightMm: 80,
};
it('imports exact vector millimetres from the editor rather than interpreting unitless SVG as 96 DPI', () => {
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><path fill="none" stroke="black" d="M0 0 H600 V400 H0 Z"/></svg>',
  );
  const svgText = vectorSnapshotSource(bytes, snapshot);
  const parsed = parseSvg({ svgText, id: 'vector', source: 'studio.svg' });
  expect(parsed.object?.bounds ?? parsed.fragment?.bounds).toEqual({
    minX: 0,
    minY: 0,
    maxX: 120,
    maxY: 80,
  });
});
it('does not guess coordinates when an export cannot preserve its viewBox', () => {
  expect(() =>
    vectorSnapshotSource(new TextEncoder().encode('<svg width="600"/>'), snapshot),
  ).toThrow('viewBox');
});
it('preserves authored source when the editor has no separate physical measurement', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm"/>';
  const { widthMm: _width, heightMm: _height, ...withoutDimensions } = snapshot;
  expect(vectorSnapshotSource(new TextEncoder().encode(source), withoutDimensions)).toBe(source);
});

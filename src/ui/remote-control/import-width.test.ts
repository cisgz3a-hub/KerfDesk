import { afterEach, beforeEach, expect, it } from 'vitest';
import { combinedBBox } from '../../core/scene/hit-test';
import {
  installDxfImportWorker,
  resetDxfImportWorker,
} from '../import/dxf-import-worker.test-support';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  installDxfImportWorker();
  adapter = testAdapter();
});
afterEach(() => {
  adapter.dispose();
  resetDxfImportWorker();
});

const svg = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><path d="${path}" fill="none" stroke="black"/></svg>`;
const dxf = (x: number, y: number) =>
  `0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n${x}\n21\n${y}\n0\nENDSEC\n0\nEOF\n`;
const file = (mimeType: string, text: string) => ({
  fileName: mimeType === 'application/dxf' ? 'line.dxf' : 'line.svg',
  mimeType,
  dataBase64: btoa(text),
});

it.each([
  ['add_svg', { svg: svg('M50 30 L150 30') }],
  ['import_file', file('image/svg+xml', svg('M50 30 L150 30'))],
  ['import_file', file('application/dxf', dxf(100, 0))],
] as const)(
  'scales a horizontal line to the requested width through %s',
  async (command, input) => {
    const before = useStore.getState().project;
    const result = await adapter.execute(
      command,
      writeArgs(adapter, { ...input, widthMm: 25, xMm: 10, yMm: 20 }),
    );
    expect(resultCode(result)).toBe('ok');
    expect(combinedBBox(useStore.getState().project.scene.objects)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 35,
      maxY: 20,
    });
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  },
);

it.each([
  ['add_svg', { svg: svg('M30 10 L30 110') }],
  ['import_file', file('application/dxf', dxf(0, 100))],
] as const)(
  'refuses a positive width for zero-width artwork without inserting through %s',
  async (command, input) => {
    const before = useStore.getState();
    const result = await adapter.execute(command, writeArgs(adapter, { ...input, widthMm: 25 }));
    expect(resultCode(result)).toBe('unsupported_operation');
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
    expect(useStore.getState().pendingUndo).toBeNull();
  },
);

it('places a vertical line when no width is requested', async () => {
  const result = await adapter.execute(
    'add_svg',
    writeArgs(adapter, { svg: svg('M30 10 L30 110'), xMm: 10, yMm: 20 }),
  );
  expect(resultCode(result)).toBe('ok');
  expect(combinedBBox(useStore.getState().project.scene.objects)).toEqual({
    minX: 10,
    minY: 20,
    maxX: 10,
    maxY: 120,
  });
});

it('keeps uniform scaling and placement for ordinary two-dimensional artwork', async () => {
  const result = await adapter.execute(
    'add_svg',
    writeArgs(adapter, {
      svg: svg('M50 30 L150 30 L150 80 L50 80 Z'),
      widthMm: 25,
      xMm: 10,
      yMm: 20,
    }),
  );
  expect(resultCode(result)).toBe('ok');
  expect(combinedBBox(useStore.getState().project.scene.objects)).toEqual({
    minX: 10,
    minY: 20,
    maxX: 35,
    maxY: 32.5,
  });
});

it('rolls back earlier batch edits when import width cannot be represented', async () => {
  const before = useStore.getState();
  const result = await adapter.execute(
    'apply_edits',
    writeArgs(adapter, {
      edits: [
        { command: 'add_rectangle', args: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 } },
        { command: 'add_svg', args: { svg: svg('M30 10 L30 110'), widthMm: 25 } },
      ],
    }),
  );
  expect(resultCode(result)).toBe('unsupported_operation');
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toEqual(before.undoStack);
});

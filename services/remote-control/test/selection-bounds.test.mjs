import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../app/src/core/scene.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
});
const { selectionBox } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const first = { id: 'first', bounds: { xMm: 10, yMm: 20, widthMm: 25, heightMm: 0 } };
const second = { id: 'second', bounds: { xMm: 60, yMm: 40, widthMm: 0, heightMm: 10 } };

test('truncated or unrepresentable summaries cannot supply partial selection bounds', () => {
  assert.equal(selectionBox(['first', 'second'], [first]), null);
  assert.equal(selectionBox(['first', 'second'], [first, { id: 'second' }]), null);
  assert.equal(selectionBox([], [first, second]), null);
});

test('complete selections retain zero axes and the full group transform footprint', () => {
  assert.deepEqual(selectionBox(['first'], [first, second]), {
    minX: 10,
    minY: 20,
    maxX: 35,
    maxY: 20,
  });
  assert.deepEqual(selectionBox(['first', 'second', 'first'], [first, second]), {
    minX: 10,
    minY: 20,
    maxX: 60,
    maxY: 50,
  });
  assert.deepEqual(
    selectionBox(
      ['first'],
      [
        {
          ...first,
          transformBounds: { xMm: 10, yMm: 20, widthMm: 50, heightMm: 30 },
        },
      ],
    ),
    { minX: 10, minY: 20, maxX: 60, maxY: 50 },
  );
});

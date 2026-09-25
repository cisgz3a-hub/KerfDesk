import type { Project, SceneObject } from '../../src/core/scene';
import { expect, type Page } from './kerfdesk-test';
import { composedSvgSnapshot, svgUndo } from './composed-svg-browser';

/** A fresh oversize file fits as one composition; the first Undo restores its authored size. */
export async function composedSvgImportStages(page: Page, objects: number, shouldFit: boolean) {
  const inserted = await composedSvgSnapshot(page);
  expect(inserted.undoCount).toBe(shouldFit ? 2 : 1);
  if (shouldFit) await svgUndo(page, objects);
  const authored = await composedSvgSnapshot(page);
  expect(authored.undoCount).toBe(1);
  if (shouldFit) expectUniformSvgFit(inserted.project, authored.project);
  return { inserted, authored };
}

function expectUniformSvgFit(fitted: Project, authored: Project): void {
  const scale = 360 / 1100;
  const cx = authored.device.bedWidth / 2;
  const cy = authored.device.bedHeight / 2;
  expect(fitted.scene.objects.map((object) => object.id)).toEqual(
    authored.scene.objects.map((object) => object.id),
  );
  for (const before of authored.scene.objects) {
    const after = fitted.scene.objects.find((object) => object.id === before.id);
    if (after === undefined) throw new Error('Fitted composition lost an object');
    expect({ ...after, transform: before.transform }).toEqual(before);
    expect(after.transform).toMatchObject({
      rotationDeg: before.transform.rotationDeg,
      mirrorX: before.transform.mirrorX,
      mirrorY: before.transform.mirrorY,
    });
    expect(after.transform.scaleX).toBeCloseTo(before.transform.scaleX * scale, 10);
    expect(after.transform.scaleY).toBeCloseTo(before.transform.scaleY * scale, 10);
    expect(after.transform.x).toBeCloseTo(cx + (before.transform.x - cx) * scale, 10);
    expect(after.transform.y).toBeCloseTo(cy + (before.transform.y - cy) * scale, 10);
  }
  expect(compositionExtent(authored.scene.objects)).toMatchObject({ width: 1100, height: 250 });
  const extent = compositionExtent(fitted.scene.objects);
  expect(extent.width).toBeCloseTo(360, 8);
  expect(extent.height).toBeCloseTo(250 * scale, 8);
  expect(extent.centerX).toBeCloseTo(cx, 8);
  expect(extent.centerY).toBeCloseTo(cy, 8);
}

/** Independent affine bounds calculation, not the app's fit or bounds implementation. */
function compositionExtent(objects: readonly SceneObject[]) {
  const points = objects.flatMap(({ bounds: b, transform: t }) => {
    const cos = Math.cos((t.rotationDeg * Math.PI) / 180);
    const sin = Math.sin((t.rotationDeg * Math.PI) / 180);
    const sx = t.scaleX * (t.mirrorX ? -1 : 1);
    const sy = t.scaleY * (t.mirrorY ? -1 : 1);
    return [
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.maxX, b.maxY],
      [b.minX, b.maxY],
    ].map(([x, y]) => ({
      x: cos * Number(x) * sx - sin * Number(y) * sy + t.x,
      y: sin * Number(x) * sx + cos * Number(y) * sy + t.y,
    }));
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

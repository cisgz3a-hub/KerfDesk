import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from './kerfdesk-test';
import { composedSvgSnapshot, exportComposedSvg, svgRedo, svgUndo } from './composed-svg-browser';
import {
  captureDocumentState,
  externalDocumentRoot,
  importDocumentFile,
  saveReopenDocument,
} from './document-import-browser';
import { pinnedDocumentFile, referenceDocumentImage } from './document-import-reference';

export function registerDocumentCurveAcceptance() {
  test('pinned upstream E1 W3C quadratic curves import render and persist', async ({
    page,
    kerfdesk,
  }, info) => {
    test.skip(
      externalDocumentRoot === undefined,
      'Set KERFDESK_DOCUMENT_CORPUS_ROOT to the separately attributed pinned corpus.',
    );
    test.setTimeout(120_000);
    await page.goto('/');
    await importDocumentFile(page, kerfdesk, pinnedDocumentFile('paths-data-02-t.svg'));
    await expect
      .poll(async () => (await composedSvgSnapshot(page)).project.scene.objects.length)
      .toBeGreaterThan(0);
    await expect(page.getByText(/9 text elements ignored/)).toBeVisible();
    await expect(page.getByText(/their fills were omitted/)).toBeVisible();
    const fitted = await captureDocumentState(page, info, 'fitted');
    expect(fitted.undoCount).toBe(2);
    for (const object of fitted.project.scene.objects) {
      expect(object.transform.scaleX).toBeCloseTo(360 / 478, 10);
      expect(object.transform.scaleY).toBeCloseTo(360 / 478, 10);
    }
    await svgUndo(page, fitted.project.scene.objects.length);
    const authored = await captureDocumentState(page, info, 'authored');
    expect(authored.undoCount).toBe(1);
    const paths = authored.project.scene.objects.flatMap((object) =>
      'paths' in object ? object.paths : [],
    );
    const contour = paths.find(
      (path) => path.color === '#00cf00' && path.curves?.[0]?.start.x === 60,
    );
    const curve = contour?.curves?.[0];
    if (curve === undefined) throw new Error('W3C closed quadratic contour is missing');
    expect(curve.closed).toBe(true);
    expect(curve.start).toEqual({ x: 60, y: 100 });
    expect(curve.segments).toHaveLength(3);
    const points = contour?.polylines[0]?.points ?? [];
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(10, 9);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(110, 9);
    expect(Math.min(...points.map((p) => p.y))).toBe(100);
    expect(Math.max(...points.map((p) => p.y))).toBe(200);
    // Analytic quadratic equations from the upstream path, independent of
    // KerfDesk's parser, subdivision and curve helpers.
    for (const [index, startY, direction] of [
      [0, 100, 1],
      [1, 200, -1],
    ] as const) {
      const segment = curve.segments[index];
      if (segment?.kind !== 'cubic') throw new Error('Quadratic was not retained as a curve');
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const u = 1 - t;
        const x =
          u ** 3 * 60 +
          3 * u ** 2 * t * segment.control1.x +
          3 * u * t ** 2 * segment.control2.x +
          t ** 3 * segment.to.x;
        const y =
          u ** 3 * startY +
          3 * u ** 2 * t * segment.control1.y +
          3 * u * t ** 2 * segment.control2.y +
          t ** 3 * segment.to.y;
        expect(x).toBeCloseTo(60 - direction * 200 * t * u, 9);
        expect(y).toBeCloseTo(startY + direction * 100 * t, 9);
      }
    }
    const exported = await exportComposedSvg(page, kerfdesk);
    writeFileSync(info.outputPath('authored-export.svg'), exported);
    const translation = authored.project.scene.objects[0]?.transform;
    if (translation === undefined) throw new Error('Authored translation missing');
    for (const object of authored.project.scene.objects) {
      expect(object.transform).toEqual(translation);
      expect(object.transform.scaleX).toBe(1);
      expect(object.transform.scaleY).toBe(1);
    }
    const rendered = await compareW3cCurve(page, exported, translation);
    writeFileSync(
      info.outputPath('w3c-render.png'),
      Buffer.from(rendered.png.split(',')[1] ?? '', 'base64'),
    );
    writeFileSync(
      info.outputPath('w3c-green-contour.json'),
      JSON.stringify(rendered.metrics, null, 2),
    );
    expect(rendered.metrics.actualGreenPixels).toBeGreaterThan(6500);
    expect(rendered.metrics.actualGreenPixels).toBeLessThan(6900);
    expect(rendered.metrics.intersectionOverUnion).toBeGreaterThan(0.97);
    await svgUndo(page, 0);
    await svgRedo(page, fitted.project.scene.objects.length);
    expect((await composedSvgSnapshot(page)).project).toEqual(authored.project);
    await saveReopenDocument(page, kerfdesk, info);
  });
}

async function compareW3cCurve(page: Page, svg: string, translation: { x: number; y: number }) {
  return page.evaluate(
    async ({ svg, translation, reference }) => {
      const documentSvg = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = documentSvg.documentElement;
      root.setAttribute('viewBox', `${translation.x} ${translation.y} 480 360`);
      root.setAttribute('width', '480');
      root.setAttribute('height', '360');
      const actual = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(root))}`;
      async function paint(src: string) {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 360;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas unavailable');
        context.fillStyle = 'white';
        context.fillRect(0, 0, 480, 360);
        context.drawImage(image, 0, 0);
        return { canvas, pixels: context.getImageData(5, 96, 110, 108).data };
      }
      const [a, b] = await Promise.all([paint(actual), paint(reference)]);
      let actualGreenPixels = 0,
        referenceGreenPixels = 0,
        intersection = 0,
        union = 0;
      const green = (data: Uint8ClampedArray, index: number) =>
        Number(data[index + 1]) > Number(data[index]) + 60 &&
        Number(data[index + 1]) > Number(data[index + 2]) + 60;
      for (let i = 0; i < a.pixels.length; i += 4) {
        const actualGreen = green(a.pixels, i),
          referenceGreen = green(b.pixels, i);
        if (actualGreen) actualGreenPixels++;
        if (referenceGreen) referenceGreenPixels++;
        if (actualGreen && referenceGreen) intersection++;
        if (actualGreen || referenceGreen) union++;
      }
      return {
        png: a.canvas.toDataURL('image/png'),
        metrics: {
          region: [5, 96, 110, 108],
          actualGreenPixels,
          referenceGreenPixels,
          intersection,
          union,
          intersectionOverUnion: intersection / union,
        },
      };
    },
    { svg, translation, reference: referenceDocumentImage('paths-data-02-t-upstream.png') },
  );
}

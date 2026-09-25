import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { TestInfo } from '@playwright/test';
import { expect, type Page } from './kerfdesk-test';
import { documentFile, externalDocumentRoot } from './document-import-browser';

const hashes: Readonly<Record<string, string>> = {
  'paths-data-02-t.svg': '12c20b87175edc14344e0468644cef93fa5dba4a4181e0dd765aca9295adc0ca',
  'masking-path-02-b.svg': '3ec5631f107442034e17e74c07671ec558f7159e9fc5c878b23ad444459b3a1c',
  'boxes.pdf': '6b9daa0f7d9a31279a8606ad0617064a750cf45e8a19b3c7f3634596368d9cb0',
  'nested-form-xobjects-inline-images.pdf':
    '8a8c86f4d0cae7a43bd8d7280283b4671b392d6dd0d43486fd2c2b0de815725f',
  'multipage.tiff': 'e6ea0b435d075d8c1381db743a9be2603a9419afccbb23cc0a4fd42c29169d51',
  'spectrum.plt': '0e8c07b00c95789101627c036d68170288c07b53f6c023350ae1c0f8c1af03d0',
};

const referenceHashes: Readonly<Record<string, string>> = {
  'paths-data-02-t-upstream.png':
    'e72a5fc068dd53806d070b49c5efd5c0c3ce825899a5c0c88cdb2c6736a3365a',
  'E3-page-1-poppler-72dpi.png': '26e46e909e8bb26d5a37bb87def1fe8b4a6f7274d09174d02f018f73b5899cbe',
  'E3-page-2-poppler-72dpi.png': '40d64cdb83ff4ded6115cf0a1aabd521a5d6aef0e26c062df64dc3779655ac84',
  'E3-page-8-poppler-72dpi.png': '454de8116eecff0d81ab5fb1cc94d5cd632953ba630fb3be21d6115a3b6ebf74',
  'E4-page-1-poppler-72dpi.png': '925bdb8252fedd78a6ce6d002696ab59c2ac2b49b350a48c5533053b6aac9c70',
  'E5-page-1-pillow.png': '7f4abbfb38f146c3814ef764c87d74f18beb51dd82e3cced63ae3488be6279fa',
  'E5-page-2-pillow.png': 'fdc336d1b98505df14c19a9a02fe06cf8166159a7464c5fc27971210b155b688',
  'E5-page-3-pillow.png': 'eedc7366c55105d51325b5d606b3b0e744572ab462297f8299872b91917f2e80',
};

export function referenceDocumentImage(name: string) {
  const bytes = readFileSync(`${externalDocumentRoot}/reference/${name}`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(referenceHashes[name]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

export function pinnedDocumentFile(name: string) {
  const file = documentFile(name, true);
  expect(
    createHash('sha256')
      .update(Buffer.from(file.base64 ?? '', 'base64'))
      .digest('hex'),
  ).toBe(hashes[name]);
  return file;
}

/** Independent Poppler/Pillow/W3C image; no production rendering logic is reused. */
export async function compareDocumentReference(
  page: Page,
  info: TestInfo,
  actual: string,
  referenceName: string,
  outputName: string,
) {
  const reference = referenceDocumentImage(referenceName);
  const metrics = await compareDocumentPixels(page, actual, reference);
  writeFileSync(
    info.outputPath(`${outputName}-metrics.json`),
    JSON.stringify({ referenceName, ...metrics }, null, 2),
  );
  writeFileSync(
    info.outputPath(`${outputName}-actual.png`),
    Buffer.from(actual.split(',')[1] ?? '', 'base64'),
  );
  return metrics;
}

export async function compareDocumentPixels(page: Page, actual: string, reference: string) {
  return page.evaluate(
    async ({ actual, reference }) => {
      async function read(source: string) {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Canvas unavailable');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const [a, b] = await Promise.all([read(actual), read(reference)]);
      if (a.width !== b.width || a.height !== b.height)
        throw new Error(`Reference grid ${b.width}x${b.height}, actual ${a.width}x${a.height}`);
      let changed = 0;
      let overEight = 0;
      let sum = 0;
      let maximum = 0;
      let outsideReferenceEdge = 0;
      // A 3x3 reference range finds an edge; dilating that edge mask by one pixel
      // is equivalent to looking for a reference change within this 5x5 region.
      function nearReferenceEdge(index: number) {
        const x = (index / 4) % b.width;
        const y = Math.floor(index / 4 / b.width);
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (x + dx < 0 || x + dx >= b.width || y + dy < 0 || y + dy >= b.height) continue;
            const other = ((y + dy) * b.width + x + dx) * 4;
            for (let channel = 0; channel < 3; channel++)
              if (b.data[index + channel] !== b.data[other + channel]) return true;
          }
        return false;
      }
      for (let i = 0; i < a.data.length; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 3; channel++) {
          const difference = Math.abs(Number(a.data[i + channel]) - Number(b.data[i + channel]));
          sum += difference;
          delta = Math.max(delta, difference);
        }
        if (delta > 0) changed++;
        if (delta > 8) {
          overEight++;
          if (!nearReferenceEdge(i)) outsideReferenceEdge++;
        }
        maximum = Math.max(maximum, delta);
      }
      const patches = [92, 292, 492]
        .flatMap((y) =>
          [72, 192].map((x) => {
            if (a.width !== 612 || a.height !== 792) return null;
            let gray = 0;
            for (let py = y; py < y + 100; py++)
              for (let px = x; px < x + 100; px++) {
                const index = (py * a.width + px) * 4;
                const [r, g, b] = [a.data[index], a.data[index + 1], a.data[index + 2]].map(Number);
                if (r !== undefined && r >= 40 && r <= 120 && r === g && r === b) gray++;
              }
            return { x, y, grayCoverage: gray / 10000 };
          }),
        )
        .filter((patch) => patch !== null);
      const pixels = a.width * a.height;
      const frameColors = [
        [0, 255, 0],
        [0, 0, 255],
        [255, 128, 0],
      ].map((color) => {
        const matches = (data: Uint8ClampedArray, index: number) =>
          color.every((value, channel) => Math.abs(Number(data[index + channel]) - value) <= 16);
        let referencePixels = 0;
        let missingNearColor = 0;
        for (let index = 0; index < b.data.length; index += 4) {
          if (!matches(b.data, index)) continue;
          referencePixels++;
          const x = (index / 4) % b.width;
          const y = Math.floor(index / 4 / b.width);
          let found = false;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (x + dx < 0 || x + dx >= b.width || y + dy < 0 || y + dy >= b.height) continue;
              if (matches(a.data, ((y + dy) * b.width + x + dx) * 4)) found = true;
            }
          if (!found) missingNearColor++;
        }
        return {
          color,
          referencePixels,
          missingNearColor,
          missingFraction: referencePixels === 0 ? 0 : missingNearColor / referencePixels,
        };
      });
      return {
        width: a.width,
        height: a.height,
        pixels,
        changed,
        overEight,
        maximum,
        outsideReferenceEdge,
        outsideReferenceEdgeFraction: outsideReferenceEdge / pixels,
        frameColors,
        meanRgbDifference: sum / (pixels * 3),
        overEightFraction: overEight / pixels,
        topLeft: [...a.data.slice(0, 4)],
        patches,
      };
    },
    { actual, reference },
  );
}

import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';
import { runMenuCommand } from './fixtures/recovery-flow';
import { testReliefHeightfield } from '../src/__fixtures__/relief-heightfield';

// A 30 mm square pocket cleared 3 mm deep with a 6 mm end mill, one row at a
// time. The tool comment is the one KerfDesk writes.
function pocket(withTool: boolean): string {
  const lines = ['G21 G90'];
  if (withTool) lines.push('; cnc tool: end-mill; diameter-mm: 6');
  lines.push('G0 Z5', 'G0 X3 Y3', 'G1 Z-3 F300');
  for (let row = 0; row <= 8; row += 1) {
    const y = (3 + row * 3).toFixed(1);
    lines.push(`G1 X${row % 2 === 0 ? 27 : 3} Y${y} F900`);
    if (row < 8) lines.push(`G1 Y${(3 + (row + 1) * 3).toFixed(1)}`);
  }
  lines.push('G0 Z5');
  return lines.join('\n');
}

async function openProgram(
  page: Page,
  kerfdesk: KerfDeskFixture,
  name: string,
  text: string,
): Promise<Locator> {
  await kerfdesk.setOpenFiles([{ name, text }]);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const dialog = page.getByRole('dialog', { name: `G-code Inspector: ${name}` });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 30_000 });
  return dialog;
}

// Pixels of the view in the stock's warm wood colours, read from a screenshot.
async function woodPixels(page: Page, view: Locator): Promise<number> {
  return countPixels(page, view, 'wood');
}

// Pixels of the view in the compare's green, where the carving is on the design.
async function greenPixels(page: Page, view: Locator): Promise<number> {
  return countPixels(page, view, 'green');
}

async function countPixels(page: Page, view: Locator, kind: 'wood' | 'green'): Promise<number> {
  const png = (await view.screenshot()).toString('base64');
  return page.evaluate(
    async ({ data, kind }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (context === null) return 0;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let wood = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        const [red, green, blue] = [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
        const isWood = red > 90 && red >= green && green - blue > 15 && red - blue > 35;
        const isGreen = green > red + 40 && green > blue + 30;
        if (kind === 'wood' ? isWood : isGreen) wood += 1;
      }
      return wood;
    },
    { data: png, kind },
  );
}

// Pixels of one picture of the view darker than another's by more than a
// trace, away from the view's frame, where its focus ring is.
async function darkerPixels(page: Page, darker: Buffer, than: Buffer): Promise<number> {
  return page.evaluate(
    async ({ pictures }) => {
      const read = async (data: string): Promise<ImageData | null> => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0);
        return context?.getImageData(0, 0, image.width, image.height) ?? null;
      };
      const [a, b] = await Promise.all(pictures.map(read));
      if (a === null || b === null || a === undefined || b === undefined) return 0;
      const frame = 4;
      let count = 0;
      for (let y = frame; y < a.height - frame; y += 1) {
        for (let x = frame; x < a.width - frame; x += 1) {
          const at = (y * a.width + x) * 4;
          const sum = (data: Uint8ClampedArray): number =>
            (data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0);
          if (sum(b.data) - sum(a.data) > 24) count += 1;
        }
      }
      return count;
    },
    { pictures: [darker.toString('base64'), than.toString('base64')] },
  );
}

type Corner = readonly [number, number, number];

// Saves the carved stock through a stand-in save picker that keeps the bytes,
// and reads the binary STL back: each triangle's three corners.
async function savedStl(page: Page, dialog: Locator): Promise<Corner[][]> {
  await page.evaluate(() => {
    const target = window as unknown as { __stl?: string; showSaveFilePicker: unknown };
    target.showSaveFilePicker = async () => ({
      kind: 'file',
      name: 'carved-stock.stl',
      createWritable: async () => {
        let bytes = new Uint8Array(0);
        return {
          write: async (data: Blob) => {
            bytes = new Uint8Array(await data.arrayBuffer());
          },
          close: async () => {
            let text = '';
            for (const byte of bytes) text += String.fromCharCode(byte);
            target.__stl = btoa(text);
          },
          abort: async () => undefined,
        };
      },
    });
  });
  await dialog.getByRole('button', { name: 'Save as STL…' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Saved carved-stock.stl' }),
  ).toBeVisible({ timeout: 30_000 });
  const base64 = await page.evaluate(() => (window as unknown as { __stl?: string }).__stl ?? '');
  const bytes = Buffer.from(base64, 'base64');
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  const triangles: Corner[][] = [];
  for (let at = 0; at < count; at += 1) {
    const base = 84 + at * 50 + 12;
    const corner = (k: number): Corner => [
      bytes.readFloatLE(base + k * 12),
      bytes.readFloatLE(base + k * 12 + 4),
      bytes.readFloatLE(base + k * 12 + 8),
    ];
    triangles.push([corner(0), corner(1), corner(2)]);
  }
  return triangles;
}

// Edges not walked once each way by the triangles either side: 0 when closed.
function openEdges(triangles: Corner[][]): number {
  const walked = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${String(p)}>${String(q)}`;
      walked.set(key, (walked.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, count] of walked) {
    const [p, q] = edge.split('>');
    if (count !== 1 || walked.get(`${q}>${p}`) !== 1) open += 1;
  }
  return open;
}

function volume(triangles: Corner[][]): number {
  let sum = 0;
  for (const [a, b, c] of triangles) {
    if (a === undefined || b === undefined || c === undefined) continue;
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

// A picture of the view once two taken in a row match.
async function settled(view: Locator): Promise<Buffer> {
  let last = await view.screenshot();
  await expect
    .poll(
      async () => {
        const next = await view.screenshot();
        const same = next.equals(last);
        last = next;
        return same;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

test('the Inspector carves the stock as playback runs (ADR-487)', async ({ page, kerfdesk }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  const dialog = await openProgram(page, kerfdesk, 'stock-pocket.nc', pocket(true));
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  const looks = dialog.getByRole('group', { name: '3D look' });
  const show = dialog.getByRole('checkbox', { name: 'Show carved stock' });
  const over = dialog.getByRole('checkbox', { name: 'Toolpath over the stock' });
  // A still camera, so pictures taken at the same place in the program match.
  await dialog
    .getByRole('group', { name: 'Camera mode' })
    .getByRole('button', { name: 'Manual' })
    .click();
  await expect(show).not.toBeChecked();
  await expect(over).toBeDisabled();
  const withoutStock = await woodPixels(page, view);

  // At the start of the program the stock is a whole block.
  await show.check();
  await view.focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => woodPixels(page, view), { timeout: 30_000 })
    .toBeGreaterThan(withoutStock + 20_000);
  const uncut = await settled(view);
  // The file gives its bit, so nothing is carved with a stand-in.
  await expect(dialog.getByText(/No bit size in the file/)).toHaveCount(0);

  // At the end the pocket is carved; back at the start it is whole again, and
  // at the end once more the same pocket is carved.
  await page.keyboard.press('End');
  await expect.poll(async () => (await view.screenshot()).equals(uncut)).toBe(false);
  const carved = await settled(view);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await view.screenshot()).equals(uncut)).toBe(true);
  await page.keyboard.press('End');
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(true);

  // Another material draws the same carving in its colours: a black laminate
  // shows no wood, and wood again the same picture.
  const material = dialog.getByLabel('Stock material');
  await expect(material).toHaveValue('wood');
  const wood = await woodPixels(page, view);
  await material.selectOption('laminate');
  await expect.poll(() => woodPixels(page, view), { timeout: 20_000 }).toBeLessThan(wood / 4);
  await material.selectOption('wood');
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(true);

  // Shadows fall into the pocket and its corners darken; without them the
  // carving is lighter, and with them again the same picture.
  const shading = dialog.getByRole('checkbox', { name: 'Shadows and occlusion' });
  await expect(shading).toBeChecked();
  await shading.uncheck();
  // The view keeps the keys' hint, as when the pictures before were taken.
  await view.focus();
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(false);
  const unshaded = await settled(view);
  const shadowed = await darkerPixels(page, carved, unshaded);
  expect(shadowed).toBeGreaterThan(3_000);
  expect(await darkerPixels(page, unshaded, carved)).toBeLessThan(shadowed / 10);
  await shading.check();
  await view.focus();
  await expect
    .poll(async () => {
      const again = await view.screenshot();
      return (await darkerPixels(page, again, carved)) + (await darkerPixels(page, carved, again));
    })
    .toBe(0);

  // The toolpath can be drawn over the stock, in both looks.
  await over.check();
  await expect.poll(async () => (await view.screenshot()).equals(carved)).toBe(false);
  await looks.getByRole('button', { name: 'Studio' }).click();
  await expect
    .poll(() => woodPixels(page, view), { timeout: 20_000 })
    .toBeGreaterThan(withoutStock + 20_000);
  await looks.getByRole('button', { name: 'Classic' }).click();

  // Saved as STL, the carving is a closed solid: the block the program
  // stands in (34 mm square, 4 mm deep: the moves, the bit and 2 mm round
  // them) less the 30 mm pocket 3 mm deep with round corners.
  const stl = await savedStl(page, dialog);
  expect(openEdges(stl)).toBe(0);
  const pocketMm3 = (30 * 30 - (4 - Math.PI) * 9) * 3;
  expect(volume(stl)).toBeGreaterThan((34 * 34 * 4 - pocketMm3) * 0.98);
  expect(volume(stl)).toBeLessThan((34 * 34 * 4 - pocketMm3) * 1.02);
  // The flat top and floor are strips, not two triangles a cell.
  expect(stl.length).toBeLessThan(40_000);

  await show.uncheck();
  await expect
    .poll(() => woodPixels(page, view), { timeout: 20_000 })
    .toBeLessThan(withoutStock + 2_000);
  expect(problems).toEqual([]);
});

test('a program without its bit carves with a stand-in, and says so (ADR-487)', async ({
  page,
  kerfdesk,
}) => {
  await page.goto('/');
  const dialog = await openProgram(page, kerfdesk, 'stock-no-tool.nc', pocket(false));
  await dialog.getByRole('checkbox', { name: 'Show carved stock' }).check();
  await expect(dialog.getByText(/No bit size in the file for some moves/)).toContainText(
    '3.175 mm end mill',
  );
});

const DOME_SAMPLES = 24;

// A dome 30 mm across and 3 mm deep, high in the middle.
function domeSource() {
  const samplesU8: number[] = [];
  for (let row = 0; row < DOME_SAMPLES; row += 1) {
    for (let column = 0; column < DOME_SAMPLES; column += 1) {
      const u = ((column + 0.5) / DOME_SAMPLES) * 2 - 1;
      const v = ((row + 0.5) / DOME_SAMPLES) * 2 - 1;
      samplesU8.push(Math.round(255 * Math.max(0, 1 - (u * u + v * v) * 0.5)));
    }
  }
  return testReliefHeightfield({
    width: DOME_SAMPLES,
    height: DOME_SAMPLES,
    physicalWidthMm: 30,
    physicalHeightMm: 30,
    maxDepthMm: 3,
    samplesU8,
  });
}

// A CNC project of MDF, 9 mm thick, with the dome on a relief operation. The
// dev server may reload the page the first time the modules are imported this
// way; the project is then seeded once more.
async function seedReliefProject(page: Page): Promise<void> {
  const menu = page.getByRole('menubar', { name: 'Application menu' });
  for (let attempt = 0; ; attempt += 1) {
    await expect(menu).toBeVisible();
    try {
      await seedOnce(page);
      break;
    } catch (error) {
      if (attempt > 0 || !String(error).includes('Execution context was destroyed')) throw error;
      await page.waitForLoadState('load');
    }
  }
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
}

async function seedOnce(page: Page): Promise<void> {
  await page.evaluate(async (reliefSource) => {
    const scenePath = '/src/core/scene/index.ts';
    const statePath = '/src/ui/state/store.ts';
    // Runtime module contracts are deliberately narrow: the runner TS project
    // must not pull in the app's separate Vite globals and browser library set.
    const scene = (await import(scenePath)) as {
      createProject: () => object;
      createLayer: (args: { id: string; color: string }) => object;
      DEFAULT_CNC_MACHINE_CONFIG: { stock: object };
      DEFAULT_CNC_LAYER_SETTINGS: object;
      IDENTITY_TRANSFORM: object;
    };
    const { useStore } = (await import(statePath)) as {
      useStore: { setState: (patch: object) => void };
    };
    const color = '#a0522d';
    useStore.setState({
      project: {
        ...scene.createProject(),
        machine: {
          ...scene.DEFAULT_CNC_MACHINE_CONFIG,
          stock: {
            ...scene.DEFAULT_CNC_MACHINE_CONFIG.stock,
            thicknessMm: 9,
            materialKey: 'plywood-mdf',
          },
        },
        scene: {
          objects: [
            {
              kind: 'relief',
              id: 'dome',
              source: 'dome.png',
              reliefSource,
              targetWidthMm: 30,
              reliefDepthMm: 3,
              color,
              bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
              transform: { ...scene.IDENTITY_TRANSFORM, x: 60, y: 40, rotationDeg: 30 },
            },
          ],
          layers: [
            {
              ...scene.createLayer({ id: 'relief-op', color }),
              output: true,
              cnc: {
                ...scene.DEFAULT_CNC_LAYER_SETTINGS,
                toolId: 'em-3175',
                depthPerPassMm: 1.5,
                reliefFinishToolId: 'bn-1588',
              },
            },
          ],
        },
      },
    });
  }, domeSource());
}

test("the project's own program carves its stock and compares with its relief (ADR-487)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  await seedReliefProject(page);
  await runMenuCommand(page, 'File', 'Inspect G-code (3D)...');
  const dialog = page.getByRole('dialog', { name: /G-code Inspector: .*current canvas/ });
  await expect(dialog.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 90_000 });
  const view = dialog.getByLabel('3D G-code toolpath', { exact: true });
  await dialog.getByRole('checkbox', { name: 'Show carved stock' }).check();
  // The project's stock is MDF, so the stock starts as MDF.
  await expect(dialog.getByLabel('Stock material')).toHaveValue('mdf');
  const compare = dialog.getByRole('checkbox', { name: 'Compare with the design' });
  await expect(compare).toBeVisible({ timeout: 60_000 });
  const before = await greenPixels(page, view);
  await compare.check();
  const results = dialog.getByRole('list', { name: 'Carving against the design' });
  await expect(results).toContainText('Cut too deep: 0%', { timeout: 60_000 });
  const within = Number(/Within 0\.1 mm: (\d+)%/.exec((await results.textContent()) ?? '')?.[1]);
  expect(within).toBeGreaterThan(60);
  await expect
    .poll(() => greenPixels(page, view), { timeout: 20_000 })
    .toBeGreaterThan(before + 5_000);
  // A tighter tolerance counts the finishing ball's scallops as material left.
  await dialog.getByLabel('Compare tolerance').selectOption('0.05');
  await expect(results).toContainText('Within 0.05 mm');
  const tight = Number(/Within 0\.05 mm: (\d+)%/.exec((await results.textContent()) ?? '')?.[1]);
  expect(tight).toBeLessThan(within);
  await compare.uncheck();
  await expect(results).toHaveCount(0);
  await expect
    .poll(() => greenPixels(page, view), { timeout: 20_000 })
    .toBeLessThan(before + 1_000);
  expect(problems).toEqual([]);
});

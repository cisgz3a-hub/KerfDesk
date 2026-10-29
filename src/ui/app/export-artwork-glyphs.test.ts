import { describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import { buildTextObject } from '../text/build-text-object';
import { handleExportArtworkDxf } from './export-artwork-dxf';
import { handleExportArtworkFormat } from './export-artwork-format';
import { handleExportArtworkSvg } from './export-artwork-svg';
import { printableArtworkSvg } from './print-artwork';

vi.mock('../text/font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer;
  },
}));

// Rolling audit v8 N4-P1-2 (ADR-591 Amendment 2): an export outlines text with the glyphs its font
// has, so it names the characters each text lost, as Start and Save do.
const WARNING = 'Text “Café 李”: Pacifico has no 李; each engraves as a box, or not at all.';

describe('artwork exports name characters a text’s font lacks', () => {
  it('SVG export warns in its done toast', async () => {
    const pushToast = vi.fn();
    await handleExportArtworkSvg({
      platform: savingPlatform('artwork.svg'),
      project: await cafeProject(),
      selectedIds: [],
      savedName: null,
      pushToast,
    });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining(WARNING), 'warning');
  });

  it('DXF and PDF exports warn in their done toasts', async () => {
    const dxfToast = vi.fn();
    await handleExportArtworkDxf({
      platform: savingPlatform('artwork.dxf'),
      project: await cafeProject(),
      selectedIds: [],
      savedName: null,
      pushToast: dxfToast,
    });
    expect(dxfToast).toHaveBeenCalledWith(expect.stringContaining(WARNING), 'warning');

    const pdfToast = vi.fn();
    await handleExportArtworkFormat({
      format: 'pdf',
      platform: savingPlatform('artwork.pdf'),
      project: await cafeProject(),
      selectedIds: [],
      savedName: null,
      pushToast: pdfToast,
    });
    expect(pdfToast).toHaveBeenCalledWith(expect.stringContaining(WARNING), 'warning');
  });

  it('print returns the warning with the printable artwork', async () => {
    const printed = await printableArtworkSvg(
      await cafeProject(),
      [],
      { blackOnly: true, lineWidthMm: 0.2 },
      new Date('2026-10-29T00:00:00Z'),
    );
    expect(printed.ok && printed.warnings).toEqual([WARNING]);
  });

  it('SVG export of text the font covers stays a plain success', async () => {
    const pushToast = vi.fn();
    await handleExportArtworkSvg({
      platform: savingPlatform('artwork.svg'),
      project: await cafeProject('Café'),
      selectedIds: [],
      savedName: null,
      pushToast,
    });
    expect(pushToast).toHaveBeenCalledWith(expect.not.stringContaining('has no'), 'success');
  });
});

function savingPlatform(displayName: string) {
  const target: SaveTarget = { displayName, write: async () => undefined };
  return mockPlatform({ save: async () => target });
}

async function cafeProject(content = 'Café 李'): Promise<Project> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
      content,
      fontKey: 'pacifico-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: true,
    },
  );
  const text: TextObject = { ...built, transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 } };
  return {
    ...createProject(),
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}

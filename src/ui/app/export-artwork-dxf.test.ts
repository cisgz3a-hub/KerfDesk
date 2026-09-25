import { describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithTwoLines } from '../../__fixtures__/file-actions';
import { IDENTITY_TRANSFORM, type Project, type SceneObject } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { parseDxf } from '../../io/dxf/parse-dxf';
import { handleExportArtworkDxf } from './export-artwork-dxf';

const renderer: VariableTextRenderer = async ({ text }) => ({
  bounds: text.bounds,
  paths: text.paths,
});

function destination(): { readonly target: SaveTarget; readonly writes: Array<string | Blob> } {
  const writes: Array<string | Blob> = [];
  return {
    writes,
    target: {
      displayName: 'parts.dxf',
      write: async (value) => {
        writes.push(value);
      },
    },
  };
}

async function textOf(value: string | Blob | undefined): Promise<string> {
  if (typeof value === 'string') return value;
  if (value === undefined) throw new Error('Expected a written DXF.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(value);
  });
}

function withImage(project: Project): Project {
  const image: SceneObject = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    pixelWidth: 1,
    pixelHeight: 1,
    linesPerMm: 1,
    dither: 'grayscale',
  };
  return { ...project, scene: { ...project.scene, objects: [...project.scene.objects, image] } };
}

describe('DXF export action', () => {
  it('writes the selected vector artwork as a millimetre DXF the importer reads back', async () => {
    const saved = destination();
    const pushToast = vi.fn();
    const pickFileForSave = vi.fn(async () => saved.target);
    await handleExportArtworkDxf({
      platform: { ...mockPlatform(), pickFileForSave },
      project: projectWithTwoLines(),
      selectedIds: ['A'],
      savedName: 'parts.lf2',
      pushToast,
      renderer,
    });
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'parts-selection.dxf',
      extensions: ['.dxf'],
    });
    const dxf = await textOf(saved.writes[0]);
    expect(dxf.split('\n').filter((line) => line.trim() === 'LWPOLYLINE')).toHaveLength(1);
    const back = parseDxf({ dxfText: dxf, id: 'back', source: 'parts.dxf' });
    expect(back.kind === 'ok' && back.object !== null).toBe(true);
    expect(pushToast).toHaveBeenCalledWith(
      'Exported 1 artwork item(s) to parts.dxf in millimetres. Text is outlined.',
      'success',
    );
  });

  it('warns with a count when images are left out', async () => {
    const saved = destination();
    const pushToast = vi.fn();
    await handleExportArtworkDxf({
      platform: mockPlatform({ save: async () => saved.target }),
      project: withImage(projectWithTwoLines()),
      selectedIds: [],
      savedName: null,
      pushToast,
      renderer,
    });
    expect(saved.writes).toHaveLength(1);
    expect(pushToast).toHaveBeenCalledWith(
      'Exported 2 artwork item(s) to parts.dxf in millimetres. Text is outlined. 1 image or relief item(s) were left out.',
      'warning',
    );
  });

  it('stays silent when the save picker is cancelled', async () => {
    const pushToast = vi.fn();
    await handleExportArtworkDxf({
      platform: mockPlatform(),
      project: projectWithTwoLines(),
      selectedIds: [],
      savedName: null,
      pushToast,
      renderer,
    });
    expect(pushToast).not.toHaveBeenCalled();
  });
});

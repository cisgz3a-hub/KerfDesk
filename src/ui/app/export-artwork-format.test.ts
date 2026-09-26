import { describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithTwoLines } from '../../__fixtures__/file-actions';
import { IDENTITY_TRANSFORM, type Project, type SceneObject } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { handleExportArtworkFormat, type ArtworkVectorFormat } from './export-artwork-format';

const renderer: VariableTextRenderer = async ({ text }) => ({
  bounds: text.bounds,
  paths: text.paths,
});

function destination(name: string): {
  readonly target: SaveTarget;
  readonly writes: Array<string | Blob>;
} {
  const writes: Array<string | Blob> = [];
  return {
    writes,
    target: {
      displayName: name,
      write: async (value) => {
        writes.push(value);
      },
    },
  };
}

async function textOf(value: string | Blob | undefined): Promise<string> {
  if (typeof value === 'string') return value;
  if (value === undefined) throw new Error('Expected a written file.');
  // jsdom's Blob has no text(); read it the way the browser reads files.
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

const CASES: ReadonlyArray<{
  readonly format: ArtworkVectorFormat;
  readonly extension: string;
  readonly check: (text: string) => void;
}> = [
  {
    format: 'pdf',
    extension: '.pdf',
    check: (text) => {
      expect(text.startsWith('%PDF-1.4\n')).toBe(true);
      expect(text).toContain('/Title (parts-selection)');
    },
  },
  {
    format: 'eps',
    extension: '.eps',
    check: (text) => expect(text.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n')).toBe(true),
  },
  {
    format: 'geojson',
    extension: '.geojson',
    check: (text) => {
      const parsed = JSON.parse(text) as { type: string; features: unknown[] };
      expect(parsed.type).toBe('FeatureCollection');
      expect(parsed.features).toHaveLength(1);
    },
  },
];

describe('PDF / EPS / GeoJSON artwork export action', () => {
  for (const { format, extension, check } of CASES) {
    it(`writes the selected artwork as ${format}`, async () => {
      const saved = destination('parts' + extension);
      const pushToast = vi.fn();
      const pickFileForSave = vi.fn(async () => saved.target);
      await handleExportArtworkFormat({
        format,
        platform: { ...mockPlatform(), pickFileForSave },
        project: projectWithTwoLines(),
        selectedIds: ['A'],
        savedName: 'parts.lf2',
        pushToast,
        renderer,
      });
      expect(pickFileForSave).toHaveBeenCalledWith({
        suggestedName: 'parts-selection' + extension,
        extensions: [extension],
      });
      check(await textOf(saved.writes[0]));
      expect(pushToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Exported 1 artwork item\(s\) to parts\./),
        'success',
      );
    });
  }

  it('warns with a count when images are left out', async () => {
    const saved = destination('parts.pdf');
    const pushToast = vi.fn();
    await handleExportArtworkFormat({
      format: 'pdf',
      platform: mockPlatform({ save: async () => saved.target }),
      project: withImage(projectWithTwoLines()),
      selectedIds: [],
      savedName: null,
      pushToast,
      renderer,
    });
    expect(saved.writes).toHaveLength(1);
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining('1 image or relief item(s) were left out.'),
      'warning',
    );
  });

  it('warns without opening the save picker when the selection holds only images', async () => {
    const pushToast = vi.fn();
    const pickFileForSave = vi.fn(async () => destination('x.eps').target);
    await handleExportArtworkFormat({
      format: 'eps',
      platform: { ...mockPlatform(), pickFileForSave },
      project: withImage(projectWithTwoLines()),
      selectedIds: ['photo'],
      savedName: null,
      pushToast,
      renderer,
    });
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'EPS export holds vector artwork only. Select vector, text or traced artwork.',
      'warning',
    );
  });

  it('stays silent when the save picker is cancelled', async () => {
    const pushToast = vi.fn();
    await handleExportArtworkFormat({
      format: 'geojson',
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

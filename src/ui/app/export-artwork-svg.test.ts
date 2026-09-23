import { describe, expect, it, vi } from 'vitest';
import {
  mockPlatform,
  projectWithLine,
  projectWithTwoLines,
} from '../../__fixtures__/file-actions';
import { DEFAULT_PROJECT_VARIABLE_DATA, type Project, type TextObject } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { handleExportArtworkSvg } from './export-artwork-svg';

function destination(): { readonly target: SaveTarget; readonly writes: Array<string | Blob> } {
  const writes: Array<string | Blob> = [];
  return {
    writes,
    target: {
      displayName: 'artwork.svg',
      write: async (value) => {
        writes.push(value);
      },
    },
  };
}
async function textOf(value: string | Blob | undefined): Promise<string> {
  if (typeof value === 'string') return value;
  if (value === undefined) throw new Error('Expected a written SVG.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(value);
  });
}
function variableProject(): Project {
  const p = projectWithLine();
  const base = p.scene.objects[0];
  if (base === undefined || !('paths' in base)) throw new Error('Missing fixture.');
  const text: TextObject = {
    ...base,
    kind: 'text',
    content: 'Serial {{serial:3}}',
    color: '#000000',
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    variableTemplate: {
      tokens: [
        { kind: 'literal', value: 'Serial ' },
        { kind: 'serial', prefix: '', width: 3 },
      ],
    },
  };
  return {
    ...p,
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      serialValue: 7,
      advancement: 'after-successful-export',
    },
    scene: { ...p.scene, objects: [text] },
  };
}
const renderer: VariableTextRenderer = async ({ text }) => ({
  bounds: text.bounds,
  paths: text.paths,
});

describe('SVG export action', () => {
  it('captures the selected artwork before the picker resolves', async () => {
    const saved = destination();
    let finishPicker: (target: SaveTarget) => void = () => undefined;
    const ids = ['A'];
    const pending = handleExportArtworkSvg({
      platform: mockPlatform({
        save: () =>
          new Promise((resolve) => {
            finishPicker = resolve;
          }),
      }),
      project: projectWithTwoLines(),
      selectedIds: ids,
      savedName: 'parts.lf2',
      pushToast: vi.fn(),
    });
    ids[0] = 'B';
    finishPicker(saved.target);
    await pending;
    const svg = await textOf(saved.writes[0]);
    expect(svg).toContain('viewBox="10 0 10 0.01"');
    expect(svg).not.toContain('<title>B.svg</title>');
  });

  it('materialises current variables once without consuming the production cursor', async () => {
    const saved = destination();
    const p = variableProject();
    const render = vi.fn(renderer);
    const clock = vi.fn(() => new Date('2026-09-23T10:00:00Z'));
    const before = JSON.stringify(p);
    await handleExportArtworkSvg({
      platform: mockPlatform({ save: async () => saved.target }),
      project: p,
      selectedIds: [],
      savedName: null,
      pushToast: vi.fn(),
      renderer: render,
      clock,
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0].content).toBe('Serial 007');
    expect(clock).toHaveBeenCalledTimes(1);
    expect(await textOf(saved.writes[0])).toContain('<title>Serial 007</title>');
    expect(JSON.stringify(p)).toBe(before);
  });

  it('does no materialisation, image loading or writes after picker cancellation', async () => {
    const render = vi.fn(renderer),
      readImageSource = vi.fn(),
      pushToast = vi.fn();
    await handleExportArtworkSvg({
      platform: mockPlatform(),
      project: variableProject(),
      selectedIds: [],
      savedName: null,
      pushToast,
      renderer: render,
      readImageSource,
    });
    expect(render).not.toHaveBeenCalled();
    expect(readImageSource).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('does not let invalid variables outside the selection block an artwork export', async () => {
    const saved = destination();
    const p = variableProject();
    const object = p.scene.objects[0];
    if (object?.kind !== 'text') throw new Error('Expected text.');
    const invalid = {
      ...object,
      id: 'bad',
      variableTemplate: { tokens: [{ kind: 'csv' as const, column: 'missing' }] },
    };
    const source = { ...p, scene: { ...p.scene, objects: [...p.scene.objects, invalid] } };
    await handleExportArtworkSvg({
      platform: mockPlatform({ save: async () => saved.target }),
      project: source,
      selectedIds: [object.id],
      savedName: null,
      pushToast: vi.fn(),
      renderer,
    });
    expect(saved.writes).toHaveLength(1);
  });

  it('reports a write failure without claiming that the SVG was saved', async () => {
    const pushToast = vi.fn();
    const target = {
      displayName: 'bad.svg',
      write: async () => {
        throw new Error('Disk full');
      },
    };
    await handleExportArtworkSvg({
      platform: mockPlatform({ save: async () => target }),
      project: projectWithLine(),
      selectedIds: [],
      savedName: null,
      pushToast,
    });
    expect(pushToast).toHaveBeenCalledExactlyOnceWith('Could not export SVG: Disk full', 'error');
  });
});

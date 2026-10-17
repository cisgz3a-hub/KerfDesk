import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTransform,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../../core/scene';
import { renderTextGeometry } from '../../text/render-text-geometry';
import { JigTextControls } from './JigTextControls';
import { isAdvancedJigText, renderJigText } from './jig-text-object';

vi.mock('../../text/render-text-geometry', () => ({ renderTextGeometry: vi.fn() }));
vi.mock('../../text/font-loader', () => ({
  ensureFontCss: vi.fn(async () => undefined),
  cssFamilyForFont: (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RENDERED = {
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
  paths: [
    {
      color: '#123456',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function textObject(): TextObject {
  return {
    kind: 'text',
    id: 'existing-text',
    content: 'Hello',
    fontKey: 'roboto-regular',
    sizeMm: 12,
    color: '#123456',
    alignment: 'center',
    lineHeight: 1.5,
    letterSpacing: 0.2,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    paths: [{ ...RENDERED.paths[0]!, operationIds: ['path-op'] }],
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 45,
      y: 70,
      rotationDeg: 35,
      scaleX: 2,
      scaleY: 0.75,
      mirrorX: true,
    },
    operationIds: ['object-op'],
    powerScale: 0.8,
    operationOverride: { speed: 900 },
  };
}

function projectWithText(text = textObject()): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [text] } };
}

describe('jig text geometry', () => {
  beforeEach(() => vi.mocked(renderTextGeometry).mockReset().mockResolvedValue(RENDERED));

  it('keeps transformed centre, object identity, operation bindings and overrides when changing font', async () => {
    const existing = textObject();
    const object = await renderJigText({
      project: projectWithText(existing),
      existing,
      content: 'New writing',
      fontKey: 'roboto-regular',
      sizeMm: 20,
    });
    const before = applyTransform({ x: 10, y: 5 }, existing.transform);
    const after = applyTransform({ x: 20, y: 10 }, object.transform);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(object).toMatchObject({
      id: existing.id,
      operationIds: existing.operationIds,
      powerScale: 0.8,
      operationOverride: existing.operationOverride,
      content: 'New writing',
    });
    expect(object.transform).toMatchObject({
      rotationDeg: 35,
      scaleX: 2,
      scaleY: 0.75,
      mirrorX: true,
    });
    expect(object.paths[0]?.operationIds).toEqual(['path-op']);
    expect(renderTextGeometry).toHaveBeenCalledWith(
      expect.objectContaining({
        alignment: 'center',
        lineHeight: 1.5,
        letterSpacing: 0.2,
        color: '#123456',
      }),
    );
  });

  it('forwards embedded project fonts and creates centred new text without changing the project', async () => {
    const project: Project = {
      ...createProject(),
      embeddedFonts: [{ key: 'custom-font', fileName: 'custom.ttf', dataBase64: 'AA==' }],
    };
    const before = structuredClone(project);
    const object = await renderJigText({
      project,
      existing: undefined,
      content: 'Cafe\u0301',
      fontKey: 'custom-font',
      sizeMm: 12,
    });
    expect(renderTextGeometry).toHaveBeenCalledWith(
      expect.objectContaining({ embeddedFonts: project.embeddedFonts, content: 'Café' }),
    );
    expect(applyTransform({ x: 20, y: 10 }, object.transform)).toEqual({
      x: project.device.bedWidth / 2,
      y: project.device.bedHeight / 2,
    });
    expect(project).toEqual(before);
  });

  it('refuses advanced text instead of flattening its special metadata', async () => {
    const existing = {
      ...textObject(),
      pathText: { guideObjectId: 'guide', offsetMm: 2, reverse: false },
    };
    expect(isAdvancedJigText(existing)).toBe(true);
    await expect(
      renderJigText({
        project: projectWithText(existing),
        existing,
        content: 'Changed',
        fontKey: 'roboto-regular',
        sizeMm: 12,
      }),
    ).rejects.toThrow('main text editor');
    expect(renderTextGeometry).not.toHaveBeenCalled();
  });
});

describe('JigTextControls', () => {
  let host: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  const onUpsert = vi.fn();
  const onBusyChange = vi.fn();

  beforeEach(() => {
    vi.mocked(renderTextGeometry).mockReset().mockResolvedValue(RENDERED);
    onUpsert.mockReset();
    onBusyChange.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    unmounted = false;
  });
  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount());
    host.remove();
  });

  async function show(
    project: Project,
    selectedIds: ReadonlySet<string> = new Set(['existing-text']),
  ): Promise<void> {
    await act(async () =>
      root.render(
        <JigTextControls
          project={project}
          selectedIds={selectedIds}
          onUpsert={onUpsert}
          onBusyChange={onBusyChange}
        />,
      ),
    );
  }
  async function clickUpdate(): Promise<void> {
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Update text',
    );
    if (!button) throw new Error('Update text missing');
    await act(async () => button.click());
  }

  it('uses the existing font picker and updates selected text through its callback', async () => {
    await show(projectWithText());
    expect(host.querySelector('[aria-haspopup="dialog"]')).not.toBeNull();
    await clickUpdate();
    expect(onUpsert).toHaveBeenCalledOnce();
    expect(onUpsert.mock.calls[0]?.[0]).toMatchObject({ id: 'existing-text', content: 'Hello' });
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it.each(['selection', 'project', 'unmount'] as const)(
    'discards a font render after %s changes',
    async (change) => {
      let finish!: (value: typeof RENDERED) => void;
      vi.mocked(renderTextGeometry).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const project = projectWithText();
      await show(project);
      await clickUpdate();
      if (change === 'selection') await show(project, new Set());
      if (change === 'project') await show({ ...project });
      if (change === 'unmount') {
        await act(async () => root.unmount());
        unmounted = true;
      }
      await act(async () => finish(RENDERED));
      expect(onUpsert).not.toHaveBeenCalled();
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    },
  );

  it('shows advanced text guidance and never offers a destructive update', async () => {
    await show(projectWithText({ ...textObject(), bendDeg: 45 }));
    expect(host.textContent).toContain('main text editor');
    expect(host.textContent).not.toContain('Update text');
    expect(renderTextGeometry).not.toHaveBeenCalled();
  });
});

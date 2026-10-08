import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
  cncOmissionProject,
  cncOmissionRelief,
} from '../../__fixtures__/cnc-open-contours';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { DEFAULT_CNC_LAYER_SETTINGS, type Project } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncOpenPathNote } from './CncOpenPathNote';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderNote(project: Project): Promise<{ host: HTMLDivElement; root: Root }> {
  vi.useFakeTimers();
  useStore.setState({ project });
  const layer = project.scene.layers[0];
  if (layer === undefined) throw new Error('C1 fixture needs its pocket layer');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CncOpenPathNote layer={layer} settings={layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS} />,
    ),
  );
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  return { host, root };
}

async function dispose(view: { host: HTMLDivElement; root: Root }): Promise<void> {
  await act(async () => view.root.unmount());
  view.host.remove();
}

async function noteText(project: Project): Promise<string> {
  const view = await renderNote(project);
  try {
    return view.host.textContent ?? '';
  } finally {
    await dispose(view);
  }
}

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

describe('C1 mixed pocket artwork advisory', () => {
  it('names the two skipped open paths while a closed square on the same layer still cuts', async () => {
    const text = await noteText(cncOmissionProject());
    expect(text).toMatch(/\b2\b.*open|open.*\b2\b/i);
    expect(text).toMatch(/skip|omit|not cut|uncut/i);
    expect(text).not.toContain('Every shape on this layer is an open path');
    expect(text).not.toContain('this layer contributes no toolpath');
  });

  it('updates the mixed count and clears the note when the last open path is removed', async () => {
    const project = cncOmissionProject();
    const view = await renderNote(project);
    try {
      expect(view.host.textContent).toMatch(/\b2\b.*open|open.*\b2\b/i);
      await act(async () => {
        useStore.setState({
          project: {
            ...project,
            scene: { ...project.scene, objects: [CNC_OMISSION_CLOSED, CNC_OMISSION_OPEN_A] },
          },
        });
        vi.advanceTimersByTime(350);
      });
      // The state update starts a fresh debounce after React commits the effect.
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(view.host.textContent).toMatch(/\b1\b.*open|open.*\b1\b/i);
      await act(async () => {
        useStore.setState({
          project: { ...project, scene: { ...project.scene, objects: [CNC_OMISSION_CLOSED] } },
        });
      });
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(view.host.textContent).toBe('');
    } finally {
      await dispose(view);
    }
  });

  it('control: all-open pocket artwork retains the existing no-toolpath explanation', async () => {
    const text = await noteText(cncOmissionProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B]));
    expect(text).toContain('Every shape on this layer is an open path');
    expect(text).toContain('this layer contributes no toolpath');
    expect(text).toMatch(/2 open contours are omitted/);
    expect(text).toMatch(/Engrave.*On path/);
  });

  it('describes omitted vector contours truthfully when an assigned relief still emits motion', async () => {
    const base = cncOmissionProject([CNC_OMISSION_OPEN_A]);
    const project = {
      ...base,
      scene: { ...base.scene, objects: [...base.scene.objects, cncOmissionRelief()] },
    };
    const emitted = emitGcode(project);
    expect(emitted.gcode).toMatch(/^G1 /m);
    expect(emitted.preflight.issues.map((issue) => issue.code)).not.toContain('empty-output');
    const text = await noteText(project);
    expect(text).toMatch(/1 open contour is omitted/);
    expect(text).not.toContain('Every shape on this layer is an open path');
    expect(text).not.toContain('this layer contributes no toolpath');
    expect(text).toMatch(/Engrave.*On path/);
  });

  it('keeps the all-open no-toolpath explanation when relief belongs to another operation', async () => {
    const base = cncOmissionProject([CNC_OMISSION_OPEN_A]);
    const project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [...base.scene.objects, cncOmissionRelief('different-operation')],
      },
    };
    expect(emitGcode(project).preflight.issues.map((issue) => issue.code)).toContain(
      'empty-output',
    );
    const text = await noteText(project);
    expect(text).toContain('Every shape on this layer is an open path');
    expect(text).toContain('this layer contributes no toolpath');
  });

  it('stays quiet for Output-off artwork even when its paths are open', async () => {
    expect(await noteText(cncOmissionProject([CNC_OMISSION_OPEN_A], 'pocket', false))).toBe('');
  });

  it('does not label a closed degenerate outline as an open path', async () => {
    const degenerate = {
      ...CNC_OMISSION_OPEN_A,
      paths: CNC_OMISSION_OPEN_A.paths.map((path) => ({
        ...path,
        polylines: path.polylines.map((polyline) => ({ ...polyline, closed: true })),
      })),
    };
    expect(await noteText(cncOmissionProject([degenerate]))).toBe('');
  });

  it('control: a closed-only pocket stays quiet', async () => {
    expect(await noteText(cncOmissionProject([CNC_OMISSION_CLOSED]))).toBe('');
  });

  it.each(['profile-outside', 'profile-inside', 'profile-on-path', 'engrave'] as const)(
    'control: %s stays quiet because its open strokes actually cut',
    async (cutType) => {
      expect(
        await noteText(cncOmissionProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B], cutType)),
      ).toBe('');
    },
  );
});

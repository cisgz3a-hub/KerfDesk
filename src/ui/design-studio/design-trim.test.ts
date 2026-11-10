import { beforeEach, describe, expect, it } from 'vitest';
import type { SketchLine } from '../../core/design';
import { createDesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { trimHint } from './design-trim';

const horizontal: SketchLine = {
  kind: 'line',
  id: 'h',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};
const cutAt = (x: number): SketchLine => ({
  kind: 'line',
  id: `v${x}`,
  start: { x, y: -10 },
  end: { x, y: 10 },
});

const store = (): ReturnType<typeof useDesignStudioStore.getState> =>
  useDesignStudioStore.getState();
const session = () => {
  const current = store().session;
  if (current === null) throw new Error('expected an open session');
  return current;
};

beforeEach(() => {
  useDesignStudioStore.setState({
    session: {
      ...createDesignSession({ entities: [horizontal, cutAt(30), cutAt(70)] }),
      tool: 'trim',
    },
    stash: null,
  });
});

describe('the Trim tool', () => {
  it('previews the hovered piece and says a click will trim it', () => {
    store().previewTrim({ x: 50, y: 0.3 }, 1);
    expect(session().trimPreview?.reason).toBe('ready');
    expect(session().trimPreview?.removed).toEqual([
      { x: 30, y: 0 },
      { x: 70, y: 0 },
    ]);
    expect(trimHint(session().trimPreview)).toMatch(/^Click to trim/);
  });

  it('trims on click as one undo step, then Undo restores the line whole', () => {
    store().trimAt({ x: 50, y: 0 }, 1, 'second');
    const ids = session().history.present.entities.map((entity) => entity.id);
    expect(ids).toEqual(['h', 'second', 'v30', 'v70']);
    expect(session().history.past).toHaveLength(1);
    store().undo();
    expect(session().history.present.entities[0]).toEqual(horizontal);
  });

  it('leaves an uncrossed piece alone and says why', () => {
    useDesignStudioStore.setState({
      session: { ...createDesignSession({ entities: [horizontal] }), tool: 'trim' },
      stash: null,
    });
    store().trimAt({ x: 50, y: 0 }, 1, 'unused');
    expect(session().history.past).toHaveLength(0);
    expect(trimHint(session().trimPreview)).toMatch(/Nothing crosses this piece/);
  });

  it('clears the preview when the tool changes or the pointer leaves', () => {
    store().previewTrim({ x: 50, y: 0 }, 1);
    store().setCursorMm(null);
    expect(session().trimPreview).toBeNull();
    store().previewTrim({ x: 50, y: 0 }, 1);
    store().setTool('select');
    expect(session().trimPreview).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { SketchRectangle } from '../../core/design';
import { NO_MODIFIERS } from './design-draft';
import { useDesignStudioStore } from './design-studio-store';

function reset(): void {
  useDesignStudioStore.setState({ session: null, stash: null });
}

const store = (): ReturnType<typeof useDesignStudioStore.getState> =>
  useDesignStudioStore.getState();

const session = () => {
  const current = store().session;
  if (current === null) throw new Error('expected an open session');
  return current;
};

beforeEach(reset);

describe('open and close', () => {
  it('opens a fresh session on Select', () => {
    store().openStudio();
    expect(session().tool).toBe('select');
    expect(session().history.present.entities).toHaveLength(0);
  });

  it('is idempotent — opening twice does not discard the session', () => {
    store().openStudio();
    store().setTool('circle');
    store().openStudio();
    expect(session().tool).toBe('circle');
  });

  it('stashes on close and resumes on reopen, asking nothing', () => {
    store().openStudio();
    store().setTool('rect');
    store().closeStudio();
    expect(store().session).toBeNull();
    expect(store().stash).not.toBeNull();
    store().openStudio();
    expect(session().tool).toBe('rect');
  });

  it('ignores session actions while closed instead of resurrecting one', () => {
    store().setTool('line');
    expect(store().session).toBeNull();
  });
});

describe('draw a rectangle end to end', () => {
  beforeEach(() => {
    store().openStudio();
    store().setTool('rect');
  });

  it('commits the draft as one entity, one history step, and selects it', () => {
    store().setDraft({
      tool: 'rect',
      anchorMm: { x: 10, y: 10 },
      pointerMm: { x: 60, y: 40 },
      modifiers: NO_MODIFIERS,
    });
    store().commitDraft('rect-1');

    const after = session();
    expect(after.draft).toBeNull();
    expect(after.history.present.entities).toHaveLength(1);
    expect(after.history.past).toHaveLength(1);
    expect([...after.selectedIds]).toEqual(['rect-1']);
    expect(after.dirtySinceApply).toBe(true);

    const entity = after.history.present.entities[0] as SketchRectangle;
    expect(entity.kind).toBe('rect');
    expect(entity.origin).toEqual({ x: 10, y: 10 });
    expect(entity.widthMm).toBe(50);
    expect(entity.heightMm).toBe(30);
  });

  it('undo removes it and clears the selection that pointed at it', () => {
    store().setDraft({
      tool: 'rect',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 20, y: 20 },
      modifiers: NO_MODIFIERS,
    });
    store().commitDraft('rect-2');
    store().undo();
    expect(session().history.present.entities).toHaveLength(0);
    expect([...session().selectedIds]).toEqual([]);
    store().redo();
    expect(session().history.present.entities).toHaveLength(1);
  });

  it('drops a click that never became a drag', () => {
    store().setDraft({
      tool: 'rect',
      anchorMm: { x: 5, y: 5 },
      pointerMm: { x: 5, y: 5 },
      modifiers: NO_MODIFIERS,
    });
    store().commitDraft('nothing');
    expect(session().draft).toBeNull();
    expect(session().history.present.entities).toHaveLength(0);
    expect(session().history.past).toHaveLength(0);
  });

  it('commitDraft with no draft is inert', () => {
    store().commitDraft('none');
    expect(session().history.past).toHaveLength(0);
  });
});

describe('marquee selection', () => {
  beforeEach(() => {
    store().openStudio();
    store().setTool('line');
    store().setDraft({
      tool: 'line',
      anchorMm: { x: 10, y: 10 },
      pointerMm: { x: 30, y: 10 },
      modifiers: NO_MODIFIERS,
    });
    store().commitDraft('line-a');
    store().setTool('select');
  });

  it('selects entities fully enclosed by the rectangle', () => {
    store().setMarquee({ anchorMm: { x: 0, y: 0 }, pointerMm: { x: 50, y: 50 } });
    store().commitMarquee(false);
    expect([...session().selectedIds]).toEqual(['line-a']);
    expect(session().marquee).toBeNull();
  });

  it('selects nothing when the rectangle only overlaps', () => {
    store().setMarquee({ anchorMm: { x: 0, y: 0 }, pointerMm: { x: 20, y: 50 } });
    store().commitMarquee(false);
    expect([...session().selectedIds]).toEqual([]);
  });

  it('adds to the existing selection when additive', () => {
    store().setSelection(['ghost']);
    store().setMarquee({ anchorMm: { x: 0, y: 0 }, pointerMm: { x: 50, y: 50 } });
    store().commitMarquee(true);
    expect([...session().selectedIds].sort()).toEqual(['ghost', 'line-a']);
  });

  it('does not create a history step — selection is not undoable', () => {
    const before = session().history.past.length;
    store().setMarquee({ anchorMm: { x: 0, y: 0 }, pointerMm: { x: 50, y: 50 } });
    store().commitMarquee(false);
    expect(session().history.past).toHaveLength(before);
  });
});

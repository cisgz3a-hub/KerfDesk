import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_MODIFIERS } from './design-draft';
import { handleDesignStudioKey } from './design-shortcuts';
import { useDesignStudioStore } from './design-studio-store';

// The Studio binds its keymap to the overlay root div, so the unit under test
// takes a React KeyboardEvent. Only the fields the handler reads are supplied.
type KeyInit = {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: EventTarget;
};

function press(init: KeyInit): { readonly prevented: boolean } {
  const preventDefault = vi.fn();
  const event = {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    target: init.target ?? document.createElement('div'),
    preventDefault,
  } as unknown as React.KeyboardEvent<HTMLDivElement>;
  handleDesignStudioKey(event, onFit);
  return { prevented: preventDefault.mock.calls.length > 0 };
}

let fitCalls = 0;
const onFit = (): void => {
  fitCalls += 1;
};

const store = (): ReturnType<typeof useDesignStudioStore.getState> =>
  useDesignStudioStore.getState();

const session = () => {
  const current = store().session;
  if (current === null) throw new Error('expected an open session');
  return current;
};

beforeEach(() => {
  useDesignStudioStore.setState({ session: null, stash: null });
  fitCalls = 0;
  store().openStudio();
});

describe('tool shortcuts', () => {
  it('arms a tool from its plain letter, case-insensitively', () => {
    expect(press({ key: 'r' }).prevented).toBe(true);
    expect(session().tool).toBe('rect');
    press({ key: 'C' });
    expect(session().tool).toBe('circle');
  });

  it('keeps f, o and g for Fillet, Offset and Polygon', () => {
    press({ key: 'f' });
    expect(session().tool).toBe('fillet');
    press({ key: 'o' });
    expect(session().tool).toBe('offset');
    press({ key: 'g' });
    expect(session().tool).toBe('polygon');
  });

  it('ignores an unbound key', () => {
    expect(press({ key: 'q' }).prevented).toBe(false);
    expect(session().tool).toBe('select');
  });

  it('ignores keys while focus is in a text field', () => {
    const input = document.createElement('input');
    press({ key: 'r', target: input });
    expect(session().tool).toBe('select');
  });
});

describe('view toggles take the Shift variant', () => {
  it('Shift+S, Shift+O and Shift+G toggle without arming a tool', () => {
    press({ key: 's', shiftKey: true });
    expect(session().snapEnabled).toBe(false);
    expect(session().tool).toBe('select');
    press({ key: 'o', shiftKey: true });
    expect(session().orthoEnabled).toBe(true);
    press({ key: 'g', shiftKey: true });
    expect(session().showGrid).toBe(false);
  });

  it('Shift+F calls Fit', () => {
    press({ key: 'f', shiftKey: true });
    expect(fitCalls).toBe(1);
    expect(session().tool).toBe('select');
  });
});

describe('undo and redo chords', () => {
  beforeEach(() => {
    store().setTool('rect');
    store().setDraft({
      tool: 'rect',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 20, y: 20 },
      modifiers: NO_MODIFIERS,
    });
    store().commitDraft('r1');
  });

  it('Ctrl+Z undoes and Ctrl+Y redoes', () => {
    press({ key: 'z', ctrlKey: true });
    expect(session().history.present.entities).toHaveLength(0);
    press({ key: 'y', ctrlKey: true });
    expect(session().history.present.entities).toHaveLength(1);
  });

  it('Ctrl+Shift+Z also redoes', () => {
    press({ key: 'z', ctrlKey: true });
    press({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(session().history.present.entities).toHaveLength(1);
  });

  it('Meta+Z works for the same chord', () => {
    press({ key: 'z', metaKey: true });
    expect(session().history.present.entities).toHaveLength(0);
  });

  it('does not arm a tool on a Ctrl chord', () => {
    press({ key: 'r', ctrlKey: true });
    expect(session().tool).toBe('rect');
  });
});

describe('Escape is a ladder, not a close', () => {
  it('rung 1 discards the live draft and keeps the Studio open', () => {
    store().setTool('line');
    store().setDraft({
      tool: 'line',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 10, y: 10 },
      modifiers: NO_MODIFIERS,
    });
    press({ key: 'Escape' });
    expect(session().draft).toBeNull();
    expect(session().tool).toBe('line');
  });

  it('rung 2 discards a live marquee', () => {
    store().setMarquee({ anchorMm: { x: 0, y: 0 }, pointerMm: { x: 5, y: 5 } });
    press({ key: 'Escape' });
    expect(session().marquee).toBeNull();
  });

  it('rung 3 clears the selection', () => {
    store().setSelection(['a']);
    press({ key: 'Escape' });
    expect([...session().selectedIds]).toEqual([]);
    expect(store().session).not.toBeNull();
  });

  it('rung 4 returns to Select', () => {
    store().setTool('circle');
    press({ key: 'Escape' });
    expect(session().tool).toBe('select');
    expect(store().session).not.toBeNull();
  });

  it('rung 5 closes, stashing rather than prompting', () => {
    press({ key: 'Escape' });
    expect(store().session).toBeNull();
    expect(store().stash).not.toBeNull();
  });

  it('walks one rung per press rather than skipping to close', () => {
    store().setTool('rect');
    store().setSelection(['a']);
    press({ key: 'Escape' });
    expect(store().session).not.toBeNull();
    press({ key: 'Escape' });
    expect(session().tool).toBe('select');
    press({ key: 'Escape' });
    expect(store().session).toBeNull();
  });
});

describe('closed Studio', () => {
  it('ignores every key once closed', () => {
    store().closeStudio();
    expect(press({ key: 'r' }).prevented).toBe(false);
    expect(store().session).toBeNull();
  });
});

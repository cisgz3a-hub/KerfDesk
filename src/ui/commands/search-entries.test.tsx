// Command search over panel actions, Settings and lessons (ADR-604 Amendment 1,
// UX audit U6-P2-1→P3, U6-P3-1, U6-P3-2), and Learn's ranked search,
// Pro marks and lesson fixes (U6-P3-1, U6-P3-4, U6-P3-6).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineKind } from '../../core/scene';
import { shortcutFamilies } from '../common/shortcut-list';
import { EditionContext, UNRESTRICTED_EDITION } from '../licensing/edition';
import { useToastStore } from '../state/toast-store';
import { pathTextTitle } from '../text/PathTextFields';
import { rankTutorials } from '../tutorials/tutorial-catalog';
import { TutorialLibrary } from '../tutorials/TutorialLibrary';
import { commandFamilyLabel } from './command-family-label';
import { buildAppCommands } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { commandSearchEntry, searchEntries } from './command-search';
import { revealSearchTarget, searchExtraEntries } from './search-entries';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function ranked(
  query: string,
  machineKind: MachineKind = 'laser',
  ctx = baseCtx(),
): ReadonlyArray<string> {
  const menu = buildAppCommands(ctx).map((command) =>
    commandSearchEntry(command, commandFamilyLabel(command.family, machineKind)),
  );
  return searchEntries([...menu, ...searchExtraEntries(machineKind, query)], query).map(
    (result) => result.entry.id,
  );
}

describe('Ctrl+K finds what a beginner types first', () => {
  it.each([
    ['frame', 'panel.frame-job'],
    ['frame job', 'panel.frame-job'],
    ['set origin', 'panel.set-origin'],
    ['setorigin', 'panel.set-origin'],
    ['start', 'panel.start-job'],
    ['jog', 'panel.jog'],
    ['machine setup', 'panel.machine-setup'],
    ['materials', 'panel.materials'],
    ['shortcuts', 'help.keyboard-shortcuts'],
    ['keyboard shortcuts', 'help.keyboard-shortcuts'],
    ['units', 'setting.units'],
    ['inches', 'setting.units'],
    ['theme', 'setting.theme'],
  ])('puts the intended result first for "%s"', (query, expected) => {
    expect(ranked(query)[0]).toBe(expected);
  });

  it('ranks Frame job above the head move when artwork is selected (U6 refuter)', () => {
    const order = ranked('frame job', 'laser', baseCtx({ hasSelection: true }));
    const frame = order.indexOf('panel.frame-job');
    const move = order.indexOf('arrange.move-laser-to-selection-center');
    expect(frame).toBe(0);
    expect(move === -1 || move > frame).toBe(true);
  });

  it('keeps Wireframe View below Frame job for "frame"', () => {
    const order = ranked('frame');
    expect(order.indexOf('panel.frame-job')).toBeLessThan(order.indexOf('window.toggle-wireframe'));
  });

  it('lists lessons for this machine kind only, after the matching commands', () => {
    const laser = ranked('origin');
    expect(laser).toContain('lesson.origin');
    expect(laser.indexOf('panel.set-origin')).toBeLessThan(laser.indexOf('lesson.origin'));
    const lessons = searchExtraEntries('laser', 'cut').filter((entry) => entry.kind === 'lesson');
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.length).toBeLessThanOrEqual(5);
    expect(lessons.map((entry) => entry.id)).not.toContain('lesson.cnc-vcarve');
  });

  it('leaves Labs out on a CNC', () => {
    expect(searchExtraEntries('cnc', '').map((entry) => entry.id)).not.toContain('setting.labs');
  });
});

describe('a panel entry opens the panel at its control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('focuses the control, never presses it', () => {
    const click = vi.fn();
    document.body.innerHTML = '<button data-search-target="frame-job">Frame job</button>';
    const button = document.querySelector('button') as HTMLButtonElement;
    button.addEventListener('click', click);
    revealSearchTarget('frame-job', 'Frame job');
    vi.advanceTimersByTime(200);
    expect(document.activeElement).toBe(button);
    expect(click).not.toHaveBeenCalled();
  });

  it("repeats a disabled control's own reason", () => {
    document.body.innerHTML =
      '<button data-search-target="start-job" disabled title="Connect to the machine first.">Start</button>';
    revealSearchTarget('start-job', 'Start job');
    vi.advanceTimersByTime(200);
    expect(useToastStore.getState().toasts[0]?.message).toBe(
      'Start job: Connect to the machine first.',
    );
  });
});

describe("Learn's ranked search (U6-P3-1)", () => {
  const ids = (query: string, machine: MachineKind = 'laser'): ReadonlyArray<string> =>
    rankTutorials(query, machine).map((ranked) => ranked.tutorial.id);

  it('puts the lesson whose title names the word first', () => {
    expect(ids('origin')[0]).toBe('origin');
    expect(ids('material')[0]).toBe('materials');
    expect(ids('frame').slice(0, 2)).toContain('frame-start');
  });

  it('matches word starts, not letters inside a word', () => {
    expect(ids('fill')[0]).toBe('laser-fill');
    expect(ids('utline')).toEqual([]);
  });

  it("lists the other machine kind's lessons after this one's", () => {
    const order = rankTutorials('cut', 'laser');
    const firstCnc = order.findIndex((entry) => entry.tutorial.machine === 'cnc');
    const lastLaser = order.map((entry) => entry.tutorial.machine).lastIndexOf('laser');
    expect(firstCnc === -1 || firstCnc > lastLaser).toBe(true);
  });

  it('points the photo lesson at the Photo engraving window (U6-P3-5)', () => {
    expect(ids('photo engraving')[0]).toBe('laser-image');
  });
});

describe('Pro lessons in KerfDesk Free (U6-P3-4)', () => {
  let unmount: () => void = () => undefined;
  afterEach(() => unmount());

  function renderLibrary(pro: boolean): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <EditionContext.Provider value={{ ...UNRESTRICTED_EDITION, pro }}>
          <TutorialLibrary
            query="studio"
            setQuery={() => undefined}
            topic={null}
            setTopic={() => undefined}
          />
        </EditionContext.Provider>,
      ),
    );
    unmount = () => {
      act(() => root.unmount());
      host.remove();
    };
    return host;
  }

  it('marks Design Studio lessons Pro and lists the free ones first', () => {
    const host = renderLibrary(false);
    const rows = [...host.querySelectorAll('.lf-learn-lesson-link')];
    const studio = rows.find((row) => row.textContent?.startsWith('Draw in Design Studio'));
    expect(studio?.querySelector('.lf-learn-pro-badge')?.textContent).toBe('Pro');
    const firstPro = rows.findIndex((row) => row.querySelector('.lf-learn-pro-badge') !== null);
    const lastFree = rows.map((row) => row.querySelector('.lf-learn-pro-badge')).lastIndexOf(null);
    expect(lastFree).toBeLessThan(firstPro);
  });

  it('shows no mark with Pro', () => {
    expect(renderLibrary(true).querySelector('.lf-learn-pro-badge')).toBeNull();
  });
});

describe('help hints', () => {
  it('lists F12 in the shortcut table (U6-P3-2)', () => {
    const view = shortcutFamilies('laser').find((family) => family.family === 'View');
    expect(view?.rows).toContainEqual({ keys: 'F12', action: 'show or hide both side panels' });
  });

  it('says why Path text is off until a path exists (U6-P3-6)', () => {
    expect(pathTextTitle(false)).toBe(
      'Draw a line, curve or shape first; text can then follow it. Bend curves text without one.',
    );
  });
});

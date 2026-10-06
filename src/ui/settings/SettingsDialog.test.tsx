import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { DEFAULT_NUDGE_STEPS, NUDGE_STEPS_KEY, useNudgeStore } from '../state/nudge-preferences';
import { SNAP_SETTINGS_KEY } from '../state/snap-preferences';
import { useStore } from '../state/store';
import { usePreferencePersistenceStore } from '../state/preference-persistence';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import {
  WORKSPACE_LAYOUT_STORAGE_KEY,
  useWorkspaceLayoutStore,
} from '../state/workspace-layout-store';
import { appThemePreference, setAppThemePreference } from '../theme/app-theme';
import { SettingsDialog, visibleSettingsSections } from './SettingsDialog';
import { settingsLinks } from './SettingsMachineSection';
import { useSettingsDialogStore } from './settings-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const initialSnap = useUiStore.getState().snapSettings;
const initialLayout = useWorkspaceLayoutStore.getState().preference;

async function render(onClose: () => void = vi.fn()): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<SettingsDialog onClose={onClose} />));
  return document.body;
}

async function openTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (candidate) => candidate.textContent === label,
  );
  if (tab === undefined) throw new Error(`${label} tab missing`);
  await act(async () => tab.click());
}

function tabLabels(): ReadonlyArray<string | null> {
  return [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
}

function inputInLabel(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${text} input missing`);
  return input;
}

function buttonNamed(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`${text} button missing`);
  return found;
}

beforeEach(() => {
  localStorage.clear();
  usePreferencePersistenceStore.setState({ pending: new Map() });
  resetStore();
  useSettingsDialogStore.setState({ open: true, section: 'general' });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  usePreferencePersistenceStore.setState({ pending: new Map() });
  useNudgeStore.getState().resetNudgeSteps();
  useUiStore.getState().setSnapSettings(initialSnap);
  useWorkspaceLayoutStore.getState().setPreference(initialLayout);
  useMachineSetupDialogStore.getState().close();
  setAppThemePreference('system');
  localStorage.clear();
  resetStore();
});

describe('Settings window (LBG-F18)', () => {
  it('shows an honest failed-save state and retries the visible choice', async () => {
    await render();
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic preference quota refusal', 'QuotaExceededError');
    });
    await act(async () => inputInLabel('Dark').click());
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Some settings could not be saved',
    );
    expect(document.body.textContent).not.toContain('Changes apply at once and are kept');
    expect(appThemePreference()).toBe('dark');
    denied.mockRestore();
    await act(async () => buttonNamed('Retry saving settings').click());
    expect(localStorage.getItem('kerfdesk.theme.v1')).toBe('dark');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.body.textContent).toContain('Changes apply at once and are kept');
  });
  it('has General, Canvas, Machine & materials and, for a laser only, Labs', async () => {
    await render();
    expect(tabLabels()).toEqual(['General', 'Canvas', 'Machine & materials', 'Labs']);
    for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
      expect(tab.title).not.toBe('');
    }
    expect(visibleSettingsSections('cnc').map((entry) => entry.id)).toEqual([
      'general',
      'canvas',
      'machine',
    ]);
  });

  it('falls back to General when the last section was Labs and the project is CNC', async () => {
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    useSettingsDialogStore.setState({ section: 'labs' });
    await render();
    expect(tabLabels()).toEqual(['General', 'Canvas', 'Machine & materials']);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'General',
    );
  });

  it('General writes the theme and layout through their existing stores', async () => {
    await render();
    await act(async () => inputInLabel('Dark').click());
    expect(appThemePreference()).toBe('dark');
    expect(localStorage.getItem('kerfdesk.theme.v1')).toBe('dark');

    await act(async () => inputInLabel('Compact').click());
    expect(useWorkspaceLayoutStore.getState().preference).toBe('compact');
    expect(localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)).toBe('compact');
    expect(document.body.textContent).toContain('every 30 seconds');
  });

  it('Canvas shares the snap store with the canvas popover', async () => {
    await render();
    await openTab('Canvas');
    const snapping = inputInLabel('Snapping on');
    const before = useUiStore.getState().snapSettings.enabled;
    expect(snapping.checked).toBe(before);
    await act(async () => snapping.click());
    expect(useUiStore.getState().snapSettings.enabled).toBe(!before);
    expect(localStorage.getItem(SNAP_SETTINGS_KEY)).toContain(`"enabled":${String(!before)}`);
  });

  it('Canvas sets and persists the three nudge distances, and resets them', async () => {
    await render();
    await openTab('Canvas');
    const shift = document.querySelector<HTMLInputElement>(
      'input[aria-label="Shift+arrow nudge distance in millimetres"]',
    );
    const fine = document.querySelector<HTMLInputElement>(
      'input[aria-label="Ctrl+arrow (Cmd on Mac) nudge distance in millimetres"]',
    );
    if (shift === null || fine === null) throw new Error('nudge fields missing');
    expect(shift.value).toBe('10');
    expect(fine.value).toBe('0.1');
    await act(async () => {
      Simulate.change(shift, { target: { value: '25' } } as never);
    });
    await act(async () => {
      Simulate.blur(shift);
    });
    expect(useNudgeStore.getState().nudgeSteps).toEqual({ ...DEFAULT_NUDGE_STEPS, largeMm: 25 });
    expect(localStorage.getItem(NUDGE_STEPS_KEY)).toContain('"largeMm":25');

    await act(async () => buttonNamed('Reset nudge distances').click());
    expect(useNudgeStore.getState().nudgeSteps).toEqual(DEFAULT_NUDGE_STEPS);
  });

  it('Machine & materials links close Settings and open the existing places', async () => {
    const onClose = vi.fn();
    await render(onClose);
    await openTab('Machine & materials');
    await act(async () => buttonNamed('Open Machine Setup...').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');

    await act(async () => buttonNamed('Show Materials').click());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().cutsLayersView).toBe('materials');
  });

  it('CNC links go to the bit library and Recipes, never to laser Materials', () => {
    const links = settingsLinks('cnc');
    expect(links.map((link) => link.button)).toEqual([
      'Open Machine Setup...',
      'Open Bit Library...',
      'Show Recipes',
    ]);
    links[1]?.open();
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'cnc', field: 'bit-library' },
    });
  });

  it('arrow keys move between sections, and the store remembers the last one', async () => {
    await render();
    const tablist = document.querySelector('[role="tablist"]');
    if (tablist === null) throw new Error('tablist missing');
    await act(async () => {
      Simulate.keyDown(tablist, { key: 'ArrowDown' });
    });
    expect(useSettingsDialogStore.getState().section).toBe('canvas');
    await act(async () => {
      Simulate.keyDown(tablist, { key: 'ArrowUp' });
      Simulate.keyDown(tablist, { key: 'ArrowUp' });
    });
    expect(useSettingsDialogStore.getState().section).toBe('labs');
  });
});

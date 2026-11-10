// The entries command search lists beside the menu commands (ADR-604
// Amendment 1, UX audit U6-P2-1→P3): the named machine-panel actions, the
// Settings a beginner looks for by name, and the Learn lessons. The panel
// entries open the machine panel at their control and focus it; none of them
// presses the control, so a search result never moves the machine or starts a
// job. A disabled control says why, with the control's own hover text.

import type { MachineKind } from '../../core/scene';
import { openMachineSetup } from '../laser/device-setup/machine-setup-dialog-store';
import { isRemoteAccessRenderer } from '../remote-access/desktop-only';
import { openSettings, type SettingsSectionId } from '../settings/settings-dialog-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import type { RailPanelId } from '../state/ui-rail-panel';
import { rankTutorials } from '../tutorials/tutorial-catalog';
import { useTutorialStore } from '../tutorials/tutorial-store';
import type { SearchEntry } from './command-search';

/** The `data-search-target` names the side panels' controls carry. The guided
 *  first job (ADR-698) reveals the same controls. */
export type SearchTarget =
  | 'frame-job'
  | 'start-job'
  | 'set-origin'
  | 'jog'
  | 'connect'
  | 'machine-setup'
  | 'materials-tab';

// Every target lives in the machine panel except the Artwork panel's tab.
const TARGET_PANEL: Partial<Record<SearchTarget, RailPanelId>> = { 'materials-tab': 'layers' };

type PanelSpec = {
  readonly target: SearchTarget;
  readonly label: string;
  readonly detail: string;
  readonly keywords: string;
};

const PANEL_ACTIONS: ReadonlyArray<PanelSpec> = [
  {
    target: 'frame-job',
    label: 'Frame job',
    detail:
      'Trace where the job burns, beam off, before you start. Opens the machine panel at Frame job.',
    keywords: 'frame outline trace boundary where it burns check position',
  },
  {
    target: 'start-job',
    label: 'Start job',
    detail: 'Review and start the framed job. Opens the machine panel at Start.',
    keywords: 'start run burn go engrave cut begin',
  },
  {
    target: 'set-origin',
    label: 'Set origin here',
    detail:
      'Make the head position the job origin (X0 Y0). Opens the machine panel at Set origin here.',
    keywords: 'origin zero job origin user origin position',
  },
  {
    target: 'jog',
    label: 'Jog the head',
    detail: 'Move the head with the jog arrows. Opens the machine panel at the jog pad.',
    keywords: 'jog move arrows nudge position head',
  },
];

type SettingSpec = {
  readonly key: string;
  readonly label: string;
  readonly section: SettingsSectionId;
  readonly keywords: string;
};

// Named as the Settings window heads them (SettingsGeneralSection,
// SettingsCanvasSection, SETTINGS_SECTIONS).
const SETTINGS: ReadonlyArray<SettingSpec> = [
  {
    key: 'units',
    label: 'Units (millimetres or inches)',
    section: 'general',
    keywords: 'inch imperial metric mm',
  },
  { key: 'theme', label: 'Theme', section: 'general', keywords: 'dark light colour appearance' },
  { key: 'layout', label: 'Workspace layout', section: 'general', keywords: 'panels arrangement' },
  { key: 'recent', label: 'Recent projects', section: 'general', keywords: 'history files' },
  {
    key: 'simple-view',
    label: 'Simple view',
    section: 'general',
    keywords: 'beginner basic easy advanced hide fewer settings',
  },
  { key: 'autosave', label: 'Autosave', section: 'general', keywords: 'recover backup save' },
  {
    key: 'snapping',
    label: 'Snapping and grid',
    section: 'canvas',
    keywords: 'snap magnet grid spacing',
  },
  { key: 'markers', label: 'Canvas markers', section: 'canvas', keywords: 'start markers points' },
  { key: 'nudge', label: 'Nudge distance', section: 'canvas', keywords: 'arrow keys move step' },
  {
    key: 'machine',
    label: 'Machine & materials',
    section: 'machine',
    keywords: 'machine setup materials',
  },
  { key: 'labs', label: 'Labs', section: 'labs', keywords: 'experimental laser workflows' },
  { key: 'remote', label: 'Phone & MCP', section: 'remote', keywords: 'remote phone access mcp' },
];

const LESSON_LIMIT = 5;

export function searchExtraEntries(machineKind: MachineKind, query: string): SearchEntry[] {
  return [
    ...PANEL_ACTIONS.map(panelEntry),
    machineSetupEntry(),
    materialsEntry(machineKind),
    ...settingsEntries(machineKind),
    ...lessonEntries(machineKind, query),
  ];
}

function panelEntry(spec: PanelSpec): SearchEntry {
  return {
    id: `panel.${spec.target}`,
    kind: 'panel',
    label: spec.label,
    family: 'Machine panel',
    detail: spec.detail,
    keywords: `${spec.keywords} ${spec.detail}`,
    enabled: true,
    invoke: () => revealSearchTarget(spec.target, spec.label),
  };
}

function machineSetupEntry(): SearchEntry {
  const detail = 'Set up the machine: bed size, origin, controller, homing and laser.';
  return {
    id: 'panel.machine-setup',
    kind: 'panel',
    label: 'Machine Setup...',
    family: 'Machine panel',
    detail,
    keywords: `machine setup profile bed size controller baud ${detail}`,
    enabled: true,
    invoke: () => openMachineSetup(),
  };
}

function materialsEntry(machineKind: MachineKind): SearchEntry {
  const label = machineKind === 'cnc' ? 'Recipes' : 'Materials';
  const detail = `Open the ${label} tab: your saved power, speed and pass settings per material.`;
  return {
    id: 'panel.materials',
    kind: 'panel',
    label,
    family: 'Artwork panel',
    detail,
    keywords: `material library recipe preset power speed plywood ${detail}`,
    enabled: true,
    invoke: () => {
      useUiStore.getState().focusRailPanel('layers');
      useUiStore.getState().setCutsLayersView('materials');
    },
  };
}

function settingsEntries(machineKind: MachineKind): SearchEntry[] {
  return SETTINGS.filter(
    (spec) =>
      (spec.section !== 'labs' || machineKind === 'laser') &&
      (spec.section !== 'remote' || isRemoteAccessRenderer()),
  ).map((spec) => ({
    id: `setting.${spec.key}`,
    kind: 'setting',
    label: spec.label,
    family: 'Settings',
    detail: `Open Settings at ${spec.label}.`,
    keywords: `settings preferences ${spec.keywords}`,
    enabled: true,
    invoke: () => openSettings(spec.section),
  }));
}

// Lessons for this machine kind only, ranked by Learn's own search (U6-P3-1),
// and a few of them, so they follow a matching command rather than bury it.
function lessonEntries(machineKind: MachineKind, query: string): SearchEntry[] {
  if (query.trim() === '') return [];
  return rankTutorials(query, machineKind, { otherMachine: 'omit' })
    .slice(0, LESSON_LIMIT)
    .map(({ tutorial }) => ({
      id: `lesson.${tutorial.id}`,
      kind: 'lesson',
      label: tutorial.title,
      family: 'Learn',
      detail: tutorial.summary,
      keywords: `lesson tutorial ${tutorial.keywords.join(' ')} ${tutorial.summary}`,
      enabled: true,
      invoke: () => useTutorialStore.getState().openTutorial(tutorial.id),
    }));
}

/** Opens the control's side panel at the control and focuses it, after the
 *  search window has closed and given focus back. */
export function revealSearchTarget(target: SearchTarget, label: string): void {
  useUiStore.getState().focusRailPanel(TARGET_PANEL[target] ?? 'machine');
  window.setTimeout(() => {
    // Frame and Start also sit in the docked job bar; the visible copy wins.
    const control =
      [...document.querySelectorAll<HTMLElement>(`[data-search-target="${target}"]`)].find(
        (candidate) => candidate.getClientRects().length > 0,
      ) ?? document.querySelector<HTMLElement>(`[data-search-target="${target}"]`);
    if (control === null) {
      useToastStore
        .getState()
        .pushToast(
          `${label} is in the ${TARGET_PANEL[target] === 'layers' ? 'Artwork' : 'machine'} panel. Open it from Window to use it.`,
          'info',
        );
      return;
    }
    control.scrollIntoView?.({ block: 'center' });
    control.focus();
    const disabled = control instanceof HTMLButtonElement && control.disabled;
    if (disabled && control.title !== '') {
      useToastStore.getState().pushToast(`${label}: ${control.title}`, 'info');
    }
  }, REVEAL_DELAY_MS);
}

// The search window restores focus to its opener as it closes; the reveal
// runs after that, or the restored focus would replace it.
const REVEAL_DELAY_MS = 120;

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { AppMenuBar } from './AppMenuBar';
import { buildAppCommands } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import type { AppCommandContext, CommandId } from './command-types';

type Outcome = {
  readonly callback?: keyof AppCommandContext;
  readonly args?: ReadonlyArray<string | number>;
  readonly guard?: string;
  readonly url?: string;
  readonly special?: 'tutorials' | 'unavailable';
};

// Independent command-to-action expectations. Each command is clicked through
// the actual menu. This verifies the UI/command boundary, not a physical device.
const OUTCOMES: Record<CommandId, Outcome> = {
  'file.new': { callback: 'newProject', guard: 'start a new project' },
  'file.open': { callback: 'openProject' },
  'file.open-recent': { callback: 'openRecentProjects' },
  'file.save': { callback: 'saveProject' },
  'file.save-as': { callback: 'saveProjectAs' },
  'file.open-template': { callback: 'openTemplate' },
  'file.save-template': { callback: 'saveTemplate' },
  'file.import': { callback: 'importArtwork' },
  'file.import-svg': { callback: 'importSvg' },
  'file.import-dxf': { callback: 'importDxf' },
  'file.import-image': { callback: 'importImage' },
  'file.import-height-map': { callback: 'importHeightMap' },
  'file.save-gcode': { callback: 'saveGcode' },
  'file.export-svg': { callback: 'exportSvg' },
  'file.export-dxf': { callback: 'exportDxf' },
  'file.open-gcode': { callback: 'openGcodePreview' },
  'file.inspect-gcode': { callback: 'inspectCurrentGcode' },
  'edit.undo': { callback: 'undo' },
  'edit.redo': { callback: 'redo' },
  'edit.select-all': { callback: 'selectAll' },
  'edit.copy': { callback: 'copySelection' },
  'edit.cut': { callback: 'cutSelection' },
  'edit.paste': { callback: 'pasteClipboard' },
  'edit.paste-in-place': { callback: 'pasteInPlace' },
  'edit.invert-selection': { callback: 'invertSelection' },
  'edit.select-open-shapes': { callback: 'selectOpenShapes' },
  'edit.group': { callback: 'groupSelection' },
  'edit.ungroup': { callback: 'ungroupSelection' },
  'edit.lock-selection': { callback: 'lockSelection' },
  'edit.unlock-all': { callback: 'unlockAllObjects' },
  'edit.duplicate': { callback: 'duplicateSelection' },
  'edit.delete': { callback: 'deleteSelection' },
  'edit.clear-selection': { callback: 'clearSelection' },
  'tools.measure': { callback: 'measureTool' },
  'tools.add-text': { callback: 'addText' },
  'tools.registration-jig': { callback: 'toggleRegistrationPanel' },
  'tools.place-board': { callback: 'toggleBoardCapturePanel' },
  'tools.camera': { callback: 'toggleCameraPanel' },
  'tools.box-generator': { callback: 'boxGenerator' },
  'tools.barcode': { callback: 'barcodeGenerator' },
  'tools.box-fit-test': { callback: 'boxFitTest' },
  'tools.material-test': { callback: 'materialTest', guard: 'create a material test' },
  'tools.interval-test': { callback: 'intervalTest', guard: 'create an interval test' },
  'tools.scan-offset-test': { callback: 'scanOffsetTest', guard: 'create a scan offset test' },
  'tools.focus-test': { special: 'unavailable' },
  'tools.optimization-settings': { callback: 'optimizationSettings' },
  'tools.rotary-setup': { callback: 'rotarySetup' },
  'tools.print-and-cut': { callback: 'printAndCut' },
  'tools.labs': { callback: 'labsSettings' },
  'tools.adjust-image': { callback: 'adjustImage' },
  'tools.edit-image': { callback: 'editImage' },
  'tools.apply-image-mask': { callback: 'applyImageMask' },
  'tools.crop-image': { callback: 'cropImage' },
  'tools.remove-image-mask': { callback: 'removeImageMask' },
  'tools.save-processed-bitmap': { callback: 'saveProcessedBitmap' },
  'tools.trace-image': { callback: 'traceImage' },
  'tools.retrace-original': { callback: 'retraceOriginal' },
  'tools.multi-file-trace': { callback: 'multiFileTrace' },
  'tools.convert-to-path': { callback: 'convertSelectionToPath' },
  'tools.weld': { callback: 'weldSelection' },
  'tools.union-silhouette': { callback: 'unionSilhouette' },
  'tools.join-paths': { callback: 'joinPaths' },
  'tools.offset-shapes': { callback: 'offsetShapes' },
  'tools.subtract': { callback: 'subtractSelection' },
  'tools.intersect': { callback: 'intersectSelection' },
  'tools.exclude': { callback: 'excludeSelection' },
  'tools.convert-to-bitmap': { callback: 'convertToBitmap' },
  'tools.fill-selection': { callback: 'fillSelectionSeparately' },
  'tools.close-open-fill-contours': { callback: 'closeSelectedOpenFillContours' },
  'tools.close-fill-contours-with-tolerance': { callback: 'reviewCloseOpenFillContours' },
  'arrange.align-left': { callback: 'alignSelection', args: ['left'] },
  'arrange.align-center-x': { callback: 'alignSelection', args: ['center-x'] },
  'arrange.align-right': { callback: 'alignSelection', args: ['right'] },
  'arrange.align-top': { callback: 'alignSelection', args: ['top'] },
  'arrange.align-center-y': { callback: 'alignSelection', args: ['center-y'] },
  'arrange.align-bottom': { callback: 'alignSelection', args: ['bottom'] },
  'arrange.align-centers': { callback: 'alignSelection', args: ['centers'] },
  'arrange.distribute-horizontal-centers': {
    callback: 'distributeSelection',
    args: ['horizontal-centers'],
  },
  'arrange.distribute-horizontal-spacing': {
    callback: 'distributeSelection',
    args: ['horizontal-spacing'],
  },
  'arrange.distribute-vertical-centers': {
    callback: 'distributeSelection',
    args: ['vertical-centers'],
  },
  'arrange.distribute-vertical-spacing': {
    callback: 'distributeSelection',
    args: ['vertical-spacing'],
  },
  'arrange.break-apart': { callback: 'breakApartSelection' },
  'arrange.array': { callback: 'createArray' },
  'arrange.quick-nest': { callback: 'quickNest' },
  'arrange.flip-horizontal': { callback: 'flipHorizontal' },
  'arrange.flip-vertical': { callback: 'flipVertical' },
  'arrange.rotate-90-cw': { callback: 'rotateSelectionQuarterTurn', args: [1] },
  'arrange.rotate-90-ccw': { callback: 'rotateSelectionQuarterTurn', args: [-1] },
  'arrange.move-to-bed-center': { callback: 'moveSelectionToBed', args: ['c'] },
  'arrange.move-to-bed-nw': { callback: 'moveSelectionToBed', args: ['nw'] },
  'arrange.move-to-bed-n': { callback: 'moveSelectionToBed', args: ['n'] },
  'arrange.move-to-bed-ne': { callback: 'moveSelectionToBed', args: ['ne'] },
  'arrange.move-to-bed-w': { callback: 'moveSelectionToBed', args: ['w'] },
  'arrange.move-to-bed-e': { callback: 'moveSelectionToBed', args: ['e'] },
  'arrange.move-to-bed-sw': { callback: 'moveSelectionToBed', args: ['sw'] },
  'arrange.move-to-bed-s': { callback: 'moveSelectionToBed', args: ['s'] },
  'arrange.move-to-bed-se': { callback: 'moveSelectionToBed', args: ['se'] },
  'laser.connect': { callback: 'connectLaser' },
  'laser.disconnect': { callback: 'disconnectLaser' },
  'laser.home': { callback: 'homeLaser' },
  'window.toggle-preview': { callback: 'togglePreview' },
  'window.toggle-wireframe': { callback: 'toggleWireframe' },
  'window.toggle-layers-panel': { callback: 'toggleLayersPanel' },
  'window.toggle-machine-panel': { callback: 'toggleMachinePanel' },
  'window.toggle-side-panels': { callback: 'toggleSidePanels' },
  'window.reset-layout': { callback: 'resetWorkspaceLayout' },
  'window.theme-light': { callback: 'setAppTheme', args: ['light'] },
  'window.theme-dark': { callback: 'setAppTheme', args: ['dark'] },
  'window.theme-system': { callback: 'setAppTheme', args: ['system'] },
  'window.fit-view': { callback: 'resetView' },
  'window.project-notes': { callback: 'projectNotes' },
  'window.undo-history': { callback: 'undoHistory' },
  'help.about': { callback: 'showAbout' },
  'help.tutorials': { special: 'tutorials' },
  'help.connection': { callback: 'showConnectionHelp' },
  'help.safety': { callback: 'showSafety' },
  'help.report-bug': { url: 'https://github.com/cisgz3a-hub/KerfDesk/issues/new/choose' },
  'help.discussions': { url: 'https://github.com/cisgz3a-hub/KerfDesk/discussions' },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
});

function availableContext(id: CommandId): AppCommandContext {
  const eligibility = Object.fromEntries(
    Object.entries(baseCtx())
      .filter(([key, value]) => typeof value === 'boolean' && /^(can|has)/u.test(key))
      .map(([key]) => [key, true]),
  );
  return baseCtx({
    ...eligibility,
    connected: id !== 'laser.connect',
    printAndCutFeatureEnabled: true,
    printAndCutProfileSupported: true,
    printAndCut: vi.fn(),
    createArray: vi.fn(),
    quickNest: vi.fn(),
  });
}

async function clickCommand(id: CommandId, context: AppCommandContext): Promise<HTMLButtonElement> {
  await act(async () =>
    root.render(<AppMenuBar commands={buildAppCommands(context)} machineKind="laser" />),
  );
  const family = id.split('.')[0];
  const summary = host.querySelector<HTMLElement>(`[data-menu-family-summary="${family}"]`);
  if (summary === null) throw new Error(`Missing family ${family}`);
  await act(async () => summary.click());
  const button = host.querySelector<HTMLButtonElement>(`button[data-help-id="command:${id}"]`);
  if (button === null) throw new Error(`Missing menu item ${id}`);
  await act(async () => button.click());
  return button;
}

describe('every registered application menu action', () => {
  it('accounts for every registered command exactly once', () => {
    expect(
      buildAppCommands(availableContext('file.open'))
        .map((command) => command.id)
        .sort(),
    ).toEqual(Object.keys(OUTCOMES).sort());
  });

  it.each(Object.entries(OUTCOMES).map(([id, outcome]) => ({ id: id as CommandId, outcome })))(
    '$id clicks through the menu to the expected outcome',
    async ({ id, outcome }) => {
      const context = availableContext(id);
      const opened: Array<{ href: string; target: string; rel: string }> = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        opened.push({ href: this.href, target: this.target, rel: this.rel });
      });
      const button = await clickCommand(id, context);
      if (outcome.special === 'unavailable') {
        expect(button.disabled).toBe(true);
        expect(button.title).toContain('Z-motion generator');
        expect(context.focusTest).not.toHaveBeenCalled();
        expect(host.querySelector('details[open]')).not.toBeNull();
      } else {
        expect(button.disabled).toBe(false);
        expect(host.querySelector('details[open]')).toBeNull();
      }
      if (outcome.callback !== undefined) {
        expect(context[outcome.callback]).toHaveBeenCalledExactlyOnceWith(...(outcome.args ?? []));
      }
      if (outcome.guard !== undefined)
        expect(context.confirmDiscard).toHaveBeenCalledExactlyOnceWith(outcome.guard);
      for (const [name, action] of Object.entries(context)) {
        if (name === outcome.callback || (name === 'confirmDiscard' && outcome.guard !== undefined))
          continue;
        if (vi.isMockFunction(action))
          expect(action, `${id} must not call ${name}`).not.toHaveBeenCalled();
      }
      if (outcome.special === 'tutorials')
        expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: null });
      else expect(useTutorialStore.getState().isOpen).toBe(false);
      expect(opened).toEqual(
        outcome.url === undefined
          ? []
          : [{ href: outcome.url, target: '_blank', rel: 'noopener noreferrer' }],
      );
    },
  );
});

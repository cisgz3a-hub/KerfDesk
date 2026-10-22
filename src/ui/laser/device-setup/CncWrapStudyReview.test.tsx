import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { defaultCncMachiningSetup } from '../../../core/scene/cnc-machining-setup';
import { DEFAULT_CNC_WRAP_STUDY } from '../../../core/scene/cnc-wrap-study';
import {
  installChromiumSavePicker,
  type ChromiumSavePicker,
} from '../../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../../platform/web/web-adapter';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { CncWrapStudyReview } from './CncWrapStudyReview';

vi.mock('../../../io/cnc/cnc-wrap-study-artifact', () => ({
  buildCncWrapStudyArtifact: () => ({
    kind: 'ok',
    json: '{"study":"reviewed"}',
    program: 'G93',
    pathCount: 1,
    warnings: [],
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let picker: ChromiumSavePicker | null = null;

beforeEach(() => resetStore());
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  picker?.restore();
  picker = null;
});

async function renderReview(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={webAdapter}>
        <CncWrapStudyReview
          project={useStore.getState().project}
          machine={DEFAULT_CNC_MACHINE_CONFIG}
          setup={defaultCncMachiningSetup()}
          study={DEFAULT_CNC_WRAP_STUDY}
          onClose={() => undefined}
        />
      </PlatformProvider>,
    ),
  );
}

async function clickSave(): Promise<void> {
  const button = [...(host?.querySelectorAll('button') ?? [])].find(
    (node) => node.textContent === 'Save study and reference program as JSON',
  );
  if (button === undefined) throw new Error('Save study button missing');
  await act(async () => button.click());
}

function changeSourceProject(): void {
  useStore.setState({ project: { ...useStore.getState().project } });
}

function alertText(): string | null | undefined {
  return host?.querySelector('[role="alert"]')?.textContent;
}

// Audit 19-P2-1 / ADR-656 Amendment 1: Chromium empties the chosen file as its
// save picker returns, so the source check runs first and the pick commits.
describe('CNC wrap study Save over an existing file', () => {
  it('writes the reviewed study when the project changes while the picker is open', async () => {
    const disk = new Map([['cnc-wrap-study.json', 'previous study']]);
    picker = installChromiumSavePicker(disk, { whilePicking: changeSourceProject });
    await renderReview();

    await clickSave();

    await vi.waitFor(() => expect(disk.get('cnc-wrap-study.json')).toBe('{"study":"reviewed"}'));
    await vi.waitFor(() =>
      expect(alertText()).toBe(
        'Saved the study from before the source project changed. Save again to include the change.',
      ),
    );
  });

  it('keeps the old file when the project already changed, without opening the picker', async () => {
    const disk = new Map([['cnc-wrap-study.json', 'previous study']]);
    picker = installChromiumSavePicker(disk);
    await renderReview();
    changeSourceProject();

    await clickSave();

    expect(alertText()).toBe('The source project changed. Reopen the reference study.');
    expect(picker.picks()).toBe(0);
    expect(disk.get('cnc-wrap-study.json')).toBe('previous study');
  });
});

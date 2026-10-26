import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  appendReliefStroke,
  createReliefAuthoringDocument,
} from '../../core/relief/relief-authoring-document';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import { reliefComponentAsset } from '../../io/project/relief-component-asset';
import {
  installChromiumSavePicker,
  type ChromiumSavePicker,
} from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import { PlatformProvider } from '../app/platform-context';
import { ReliefLocalAssetControls } from './ReliefLocalAssetControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let picker: ChromiumSavePicker | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  picker?.restore();
  picker = null;
});

const reviewed = createReliefAuthoringDocument(
  testReliefHeightfield({
    width: 2,
    height: 2,
    physicalWidthMm: 2,
    physicalHeightMm: 2,
    maxDepthMm: 3,
    samplesU16: [100, 20000, 40000, 65000],
  }),
);
const sculpted = appendReliefStroke(reviewed, {
  schemaVersion: 1,
  id: 'stroke-1',
  componentId: 'source-1',
  mode: 'add',
  diameterMm: 1,
  strength: 0.5,
  flattenHeightMm: 0,
  points: [{ x: 1, y: 1 }],
});

async function renderControls(document: ReliefAuthoringDocument, onError = vi.fn()) {
  host ??= window.document.createElement('div');
  window.document.body.appendChild(host);
  root ??= createRoot(host);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={webAdapter}>
        <ReliefLocalAssetControls
          document={document}
          component={document.components[0]}
          disabled={false}
          onPreview={() => undefined}
          onError={onError}
        />
      </PlatformProvider>,
    ),
  );
}

// Audit 19-P2-1 / ADR-656 Amendment 1: Chromium empties the chosen file as its
// save picker returns, so the picked file gets the component from the click.
describe('relief Save component over an existing file', () => {
  it('writes the clicked component when the document changes while the picker is open', async () => {
    const disk = new Map([['relief-component.lfrelief', 'previous component']]);
    let confirm: () => void = () => undefined;
    const dialogOpen = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    picker = installChromiumSavePicker(disk, { whilePicking: () => dialogOpen });
    const onError = vi.fn();
    await renderControls(reviewed, onError);
    const save = [...(host?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent === 'Save component…',
    );
    if (save === undefined) throw new Error('Save component button missing');

    await act(async () => save.click());
    await renderControls(sculpted, onError);
    await act(async () => confirm());

    const component = reviewed.components[0];
    if (component === undefined) throw new Error('Fixture has no component');
    await vi.waitFor(() =>
      expect(disk.get('relief-component.lfrelief')).toBe(
        JSON.stringify(reliefComponentAsset(reviewed, component), null, 2) + '\n',
      ),
    );
    expect(picker.picks()).toBe(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

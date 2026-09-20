import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
} from '../../../core/scene';
import {
  cncStartupOperationDraft,
  type CncStartupOperationDraft,
} from '../../state/cnc-startup-setup';
import { BIT_PHOTO_ASSETS } from '../../tutorials/bit-photo-assets';
import { DeviceSetupCncToolPlan } from './DeviceSetupCncToolPlan';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const layer = createLayer({ id: 'picture-plan', name: 'Carving', color: '#000000' });
const machine: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  toolId: 'flat',
  tools: [
    { id: 'flat', name: 'Flat', kind: 'end-mill', diameterMm: 3, family: 'upcut' },
    { id: 'wide', name: 'Wide', kind: 'end-mill', diameterMm: 6, family: 'upcut' },
    { id: 'ball', name: 'Ball', kind: 'ball-nose', diameterMm: 2, family: 'ball-nose' },
  ],
};

let host: HTMLDivElement;
let root: Root;
const changed = vi.fn<(draft: CncStartupOperationDraft) => void>();

function Plan(): JSX.Element {
  const [draft, setDraft] = useState(cncStartupOperationDraft(layer));
  return (
    <DeviceSetupCncToolPlan
      machine={machine}
      layers={[layer]}
      drafts={[draft]}
      onChange={(next) => {
        changed(next);
        setDraft(next);
      }}
    />
  );
}

beforeEach(async () => {
  changed.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Plan />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function field(label: string): HTMLDivElement {
  const select = host.querySelector(`[aria-label="${label}"]`);
  if (
    !(select instanceof HTMLSelectElement) ||
    !(select.parentElement?.parentElement instanceof HTMLDivElement)
  )
    throw new Error('Tool selector field missing');
  return select.parentElement.parentElement;
}

async function choose(label: string, value: string): Promise<void> {
  const select = field(label).querySelector('select');
  if (select === null) throw new Error('Native tool selector missing');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Tool Plan picture selection', () => {
  it('opens only the selected primary picture, keeps the native value, and resolves job-default geometry', async () => {
    const label = 'Startup bit for Carving';
    expect(host.querySelector('img')).toBeNull();
    await choose(label, 'ball');
    expect(field(label).querySelector('select')?.value).toBe('ball');
    expect(field(label).querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-ball-nose'].small.file,
    );
    expect(changed).toHaveBeenLastCalledWith({
      ...cncStartupOperationDraft(layer),
      toolId: 'ball',
    });

    await choose(label, '');
    expect(field(label).querySelector('select')?.value).toBe('');
    expect(field(label).querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-upcut'].small.file,
    );
    expect(changed).toHaveBeenLastCalledWith(cncStartupOperationDraft(layer));
    expect(machine.toolId).toBe('flat');
    expect(layer.cnc).toBeUndefined();
  });

  it('shows no secondary picture for an empty stage and removes the picture when the stage is cleared', async () => {
    const label = 'Startup relief finishing bit for Carving';
    expect(field(label).querySelector('[data-cnc-tool-picture]')).toBeNull();
    await choose(label, 'ball');
    expect(field(label).querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-ball-nose'].small.file,
    );
    expect(changed).toHaveBeenLastCalledWith({
      ...cncStartupOperationDraft(layer),
      reliefFinishToolId: 'ball',
    });

    await choose(label, '');
    expect(field(label).querySelector('[data-cnc-tool-picture]')).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(cncStartupOperationDraft(layer));
  });

  it('retries failed pictures after reopening or selecting another bit in the same family', async () => {
    const label = 'Startup bit for Carving';
    await choose(label, 'flat');
    await failPicture(field(label));
    expect(field(label).querySelector('img')).toBeNull();
    const details = field(label).querySelector('details');
    if (details === null) throw new Error('Picture disclosure missing');
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
    });
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(field(label).querySelector('img')).not.toBeNull();
    await failPicture(field(label));
    await choose(label, 'wide');
    expect(field(label).querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-upcut'].small.file,
    );
    expect(field(label).textContent).not.toContain('Picture unavailable');
  });

  it('opens the picture when changing from inherited to explicit selection of the same bit', async () => {
    const label = 'Startup bit for Carving';
    await choose(label, 'flat');
    expect(field(label).querySelector('img')?.getAttribute('src')).toContain(
      BIT_PHOTO_ASSETS['bit-upcut'].small.file,
    );
    expect(changed).toHaveBeenLastCalledWith({
      ...cncStartupOperationDraft(layer),
      toolId: 'flat',
    });
  });
});

async function failPicture(container: ParentNode): Promise<void> {
  const image = container.querySelector('img');
  if (image === null) throw new Error('Picture missing');
  await act(async () => image.dispatchEvent(new Event('error')));
}

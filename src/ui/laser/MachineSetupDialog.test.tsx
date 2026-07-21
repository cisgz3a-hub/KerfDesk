import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { resetStore } from '../state/test-helpers';
import { MachineSetupDialog } from './MachineSetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(resetStore);

describe('MachineSetupDialog compatibility entry', () => {
  it('renders the single guided Machine Setup flow instead of competing tabs', async () => {
    const view = await renderDialog();
    try {
      expect(view.host.textContent).toContain('Step 1 of 4 — Choose your machine');
      expect(view.host.textContent).not.toContain('Profile CatalogController Settings');
      expect(view.host.textContent).not.toContain('Run guided setup');
    } finally {
      await view.unmount();
    }
  });

  it('keeps the legacy import callable while using draft-and-save semantics', async () => {
    const view = await renderDialog();
    try {
      expect(view.host.querySelector('button')?.textContent).not.toBeNull();
      expect(view.host.textContent).toContain('Cancel without saving');
      expect(view.host.textContent).toContain('Import or export a machine profile');
    } finally {
      await view.unmount();
    }
  });
});

async function renderDialog(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <MachineSetupDialog onClose={() => undefined} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { CncSetupPanel } from '../machine/CncSetupPanel';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { ProbePlateRemovalNotice } from './ProbePlateRemovalNotice';

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useLaserStore.setState({ workZZeroEvidence: null });
  useStore.setState({ project: createProject() });
});

async function renderWithPendingRemoval(element: JSX.Element): Promise<HTMLElement> {
  useStore.setState({
    project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
  });
  useLaserStore.setState((state) => ({
    capabilities: { ...state.capabilities, probing: true },
    workZReferenceEpoch: 4,
    workZZeroEvidence: {
      source: 'probe',
      referenceEpoch: 4,
      toolId: 'em-3175',
      probePlateRemoved: false,
    },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<PlatformProvider adapter={mockPlatform}>{element}</PlatformProvider>),
  );
  return host;
}

function findConfirmButton(rendered: HTMLElement): HTMLButtonElement | undefined {
  return [...rendered.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Confirm plate removed',
  );
}

describe('ProbePlateRemovalNotice', () => {
  it('keeps a visible blocker until the operator confirms plate removal', async () => {
    const rendered = await renderWithPendingRemoval(<ProbePlateRemovalNotice />);
    expect(rendered.textContent).toContain('spindle start is still blocked');
    expect(rendered.textContent).toContain('Remove the touch plate and probe lead');

    const button = findConfirmButton(rendered);
    expect(button).toBeDefined();
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'probe',
      probePlateRemoved: true,
    });
    expect(rendered.textContent).not.toContain('spindle start is still blocked');
  });

  // The probe->air-cut regression: while the confirmation lived inside the
  // collapsed "Set work zero (probe)" details, operators never saw it and
  // unblocked Start with Zero Z at the parked height instead. The notice must
  // render OUTSIDE any <details> so a folded probe section cannot hide it.
  it('is hosted outside the collapsed probe details in the CNC setup panel', async () => {
    const rendered = await renderWithPendingRemoval(<CncSetupPanel />);
    const button = findConfirmButton(rendered);
    expect(button).toBeDefined();
    expect(button?.closest('details')).toBeNull();
  });
});

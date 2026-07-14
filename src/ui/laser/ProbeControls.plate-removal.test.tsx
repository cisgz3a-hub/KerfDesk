import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { ProbeControls } from './ProbeControls';

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

async function renderControls(): Promise<HTMLElement> {
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
  await act(async () => root?.render(<ProbeControls />));
  return host;
}

describe('ProbeControls plate-removal acknowledgement', () => {
  it('keeps a visible blocker until the operator confirms plate removal', async () => {
    const rendered = await renderControls();
    expect(rendered.textContent).toContain('spindle start is still blocked');
    expect(rendered.textContent).toContain('Remove the touch plate and probe lead');

    const button = [...rendered.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Confirm plate removed',
    );
    expect(button).toBeDefined();
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'probe',
      probePlateRemoved: true,
    });
    expect(rendered.textContent).not.toContain('spindle start is still blocked');
  });
});

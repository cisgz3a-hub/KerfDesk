// JobControls CNC-mode gating (ADR-101 §5). Split from JobControls.test.tsx,
// which sits at the file-size cap — same precedent as the laser-store
// split test files.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
});

async function renderJobControls(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function buttonLabels(host: HTMLElement): ReadonlyArray<string> {
  return [...host.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

describe('JobControls machine gating (ADR-101 §5)', () => {
  it('shows the Auto-focus button for laser projects', async () => {
    useStore.setState({
      project: {
        ...createProject(),
        device: { ...createProject().device, autofocusCommand: '$HZ1' },
      },
    });
    const { host, unmount } = await renderJobControls();
    try {
      expect(buttonLabels(host)).toContain('Auto-focus');
      expect(buttonLabels(host)).toContain('Resume from line');
      expect(host.querySelector('input[aria-label="Resume from G-code line"]')).not.toBeNull();
    } finally {
      await unmount();
    }
  });

  it('hides Auto-focus in CNC mode while Home, Frame, and Start job stay', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, unmount } = await renderJobControls();
    try {
      const labels = buttonLabels(host);
      expect(labels).not.toContain('Auto-focus');
      expect(labels).toContain('Home');
      expect(labels).toContain('Frame');
      expect(labels).toContain('Start job');
      expect(labels).not.toContain('Resume from line');
      expect(host.querySelector('input[aria-label="Resume from G-code line"]')).toBeNull();
      expect(host.textContent).toContain('CNC interruption recovery');
      expect(host.textContent).not.toContain('Automatic CNC recovery disabled');
    } finally {
      await unmount();
    }
  });
});

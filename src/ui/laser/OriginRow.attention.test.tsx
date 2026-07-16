// The Set-origin attention pulse coaches exactly one situation: a ready
// no-homing machine whose User Origin start mode has no origin behind it.
// These tests pin the class wiring; the animation itself lives in tokens.css.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { OriginRow } from './OriginRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ATTENTION_CLASS = 'lf-btn--attention';

beforeEach(() => {
  resetStore();
  useLaserStore.setState({ ...initialLaserState() });
  setHomingEnabled(false);
  setStartFrom('user-origin');
});

afterEach(() => {
  resetStore();
  useLaserStore.setState({ ...initialLaserState() });
});

describe('Set origin attention pulse', () => {
  it('pulses when a ready no-homing machine has no origin and starts from User Origin', async () => {
    const view = await renderRow({ disabled: false });
    try {
      expect(setOriginButton(view.host).className).toContain(ATTENTION_CLASS);
    } finally {
      await view.unmount();
    }
  });

  it('stops pulsing once a work origin is active', async () => {
    useLaserStore.setState({ workOriginActive: true });
    const view = await renderRow({ disabled: false });
    try {
      expect(setOriginButton(view.host).className).not.toContain(ATTENTION_CLASS);
    } finally {
      await view.unmount();
    }
  });

  it('stays quiet for start modes that do not need a saved origin', async () => {
    setStartFrom('current-position');
    const view = await renderRow({ disabled: false });
    try {
      expect(setOriginButton(view.host).className).not.toContain(ATTENTION_CLASS);
    } finally {
      await view.unmount();
    }
  });

  it('stays quiet on homing machines', async () => {
    setHomingEnabled(true);
    const view = await renderRow({ disabled: false });
    try {
      expect(setOriginButton(view.host).className).not.toContain(ATTENTION_CLASS);
    } finally {
      await view.unmount();
    }
  });

  it('stays quiet while the rail is disabled or streaming', async () => {
    const disabledView = await renderRow({ disabled: true });
    try {
      expect(setOriginButton(disabledView.host).className).not.toContain(ATTENTION_CLASS);
    } finally {
      await disabledView.unmount();
    }
    const streamingView = await renderRow({ disabled: false, streaming: true });
    try {
      expect(setOriginButton(streamingView.host).className).not.toContain(ATTENTION_CLASS);
    } finally {
      await streamingView.unmount();
    }
  });
});

function setHomingEnabled(enabled: boolean): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: {
        ...state.project.device,
        homing: { ...state.project.device.homing, enabled },
      },
    },
  }));
}

function setStartFrom(startFrom: 'user-origin' | 'current-position'): void {
  useStore.setState({ jobPlacement: { startFrom, anchor: 'front-left' } });
}

async function renderRow(props: {
  readonly disabled: boolean;
  readonly streaming?: boolean;
}): Promise<{ readonly host: HTMLDivElement; readonly unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<OriginRow disabled={props.disabled} streaming={props.streaming ?? false} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function setOriginButton(host: HTMLElement): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Set origin here',
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error('Set origin here not rendered');
  return match;
}

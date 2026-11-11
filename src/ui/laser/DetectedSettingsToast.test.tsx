// A settings read with nothing to do is a log line, not a toast (annoyance
// audit A5-P3-4, ADR-611 Amendment 3).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  DETECTED_SETTINGS_NOTHING_TO_DO,
  DetectedSettingsToast,
  resetAnnouncedDetectedSettings,
} from './DetectedSettingsToast';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(async () => {
  resetAnnouncedDetectedSettings();
  useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
  useLaserStore.setState({
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    log: [],
  });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(<DetectedSettingsToast />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  document.body.replaceChildren();
});

const settingsToasts = (): ReadonlyArray<string> =>
  useToastStore
    .getState()
    .toasts.map((toast) => toast.message)
    .filter((message) => message.startsWith('Machine settings detected:'));
const settingsLog = (): ReadonlyArray<string> =>
  useLaserStore.getState().log.filter((line) => line.includes('Machine settings detected:'));

describe('DetectedSettingsToast', () => {
  it('logs a read that asks nothing of the operator and shows no toast', async () => {
    await act(async () => useLaserStore.setState({ lastSettingsReadAt: 1 }));

    expect(settingsToasts()).toEqual([]);
    expect(settingsLog()).toEqual([`[lf2] ${DETECTED_SETTINGS_NOTHING_TO_DO}`]);
  });

  it('logs it once: the same clean read again says nothing (Amendment 2)', async () => {
    await act(async () => useLaserStore.setState({ lastSettingsReadAt: 1 }));
    await act(async () => useLaserStore.setState({ lastSettingsReadAt: 2 }));

    expect(settingsToasts()).toEqual([]);
    expect(settingsLog()).toHaveLength(1);
  });

  it('still shows the toast when the read offers a profile update', async () => {
    const maxPowerS = DEFAULT_DEVICE_PROFILE.maxPowerS === 255 ? 1000 : 255;
    await act(async () =>
      useLaserStore.setState({
        detectedSettings: { maxPowerS },
        controllerSettings: { maxPowerS },
        lastSettingsReadAt: 1,
      }),
    );

    expect(settingsToasts()).toEqual([
      'Machine settings detected: safe profile updates are ready in Machine Setup.',
    ]);
    expect(settingsLog()).toEqual([]);
  });
});

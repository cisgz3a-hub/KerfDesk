import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());

describe('CNC Startup Setup profile drafts', () => {
  it('saves the staged machine without mutating the live project', () => {
    useStore.getState().setMachineKind('cnc');
    const live = useStore.getState().project.machine;
    const draft = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 27 },
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: 18000 },
    };

    useStore.getState().saveCncMachineProfileFromDraft('Staged setup', draft);

    const profile = useStore.getState().cncLibrary.machineProfiles.at(-1);
    expect(profile).toMatchObject({ name: 'Staged setup', machine: draft });
    expect(useStore.getState().project.machine).toBe(live);
  });
});

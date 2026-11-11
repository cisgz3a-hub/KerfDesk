// Shared by the Save G-code flow tests.

import { vi } from 'vitest';
import type { Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { startGcodeSave, useGcodeSaveFlowStore, type GcodeSaveFlow } from './gcode-save-flow';

export type GcodeSaveHarness = {
  readonly pickFileForSave: ReturnType<typeof vi.fn<PlatformAdapter['pickFileForSave']>>;
  readonly write: ReturnType<typeof vi.fn<(data: string | Blob) => Promise<void>>>;
  readonly pushToast: ReturnType<typeof vi.fn>;
  readonly written: string[];
  readonly start: () => void;
};

export function gcodeSaveHarness(
  project: Project,
  id: PlatformAdapter['id'] = 'web',
): GcodeSaveHarness {
  useStore.setState({ project });
  const written: string[] = [];
  const write = vi.fn(async (data: string | Blob) => {
    written.push(typeof data === 'string' ? data : `blob:${data.size}`);
  });
  const pickFileForSave = vi.fn<PlatformAdapter['pickFileForSave']>(async (request) => ({
    displayName: request.suggestedName,
    write,
  }));
  const pushToast = vi.fn();
  const platform: PlatformAdapter = {
    id,
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  return {
    pickFileForSave,
    write,
    pushToast,
    written,
    start: () => startGcodeSave({ platform, pushToast }),
  };
}

export const currentGcodeSaveFlow = (): GcodeSaveFlow | null =>
  useGcodeSaveFlowStore.getState().flow;

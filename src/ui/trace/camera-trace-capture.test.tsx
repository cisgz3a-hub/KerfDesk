import './camera-trace.test-support';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { createProject } from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import { captureSourceFrame } from '../camera/frame-source';
import type { RgbaImage } from '../../core/camera';
import {
  frame,
  old,
  deferred,
  root,
  clearRoot,
  pushToast,
  open,
} from './camera-trace.test-support';
describe('camera capture ownership and existing failure controls', () => {
  it.each(['document', 'dialog', 'dialog-closed', 'unmount', 'source'] as const)(
    'abandons a capture after %s replacement',
    async (boundary) => {
      const pending = deferred<RgbaImage | null>();
      vi.mocked(captureSourceFrame).mockReturnValueOnce(pending.promise);
      await open();
      await act(async () => {
        if (boundary === 'document') useStore.getState().setProject(createProject());
        if (boundary === 'dialog') useUiStore.getState().openImageDialog(old);
        if (boundary === 'dialog-closed') {
          useUiStore.getState().openImageDialog(old);
          useUiStore.getState().closeImageDialog();
        }
        if (boundary === 'unmount') {
          root?.unmount();
          clearRoot();
        }
        if (boundary === 'source') useCameraStore.setState({ sourceState: { kind: 'idle' } });
      });
      const before = useStore.getState().project,
        dialog = useUiStore.getState().imageDialog;
      await act(async () => {
        pending.resolve(frame);
      });
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useUiStore.getState().imageDialog).toBe(dialog);
      expect(pushToast).not.toHaveBeenCalled();
    },
  );
  it.each(['capture', 'binding', 'shape'] as const)(
    'retains the %s failure path without inserting source',
    async (failure) => {
      if (failure === 'capture') vi.mocked(captureSourceFrame).mockResolvedValueOnce(null);
      if (failure === 'shape') {
        vi.mocked(captureSourceFrame).mockResolvedValueOnce({
          width: 100,
          height: 100,
          data: new Uint8ClampedArray(100 * 100 * 4),
        });
      }
      const s = useStore.getState();
      const model = s.project.device.cameraModel!;
      if (failure === 'binding') {
        await act(async () => {
          useStore.setState({
            project: {
              ...s.project,
              device: {
                ...s.project.device,
                cameraModel: { ...model, capture: { ...model.capture!, sourceId: 'different' } },
              },
            },
          });
        });
      }
      const before = useStore.getState().project;
      await open();
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useUiStore.getState().imageDialog).toBeNull();
      expect(pushToast).toHaveBeenCalledWith(expect.any(String), 'error');
    },
  );
});

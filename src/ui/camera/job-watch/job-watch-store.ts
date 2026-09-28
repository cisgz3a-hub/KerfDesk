// What the camera saw of the last job (ADR-490): its timelapse frames and the
// burn check's verdict, plus the per-computer choices of what to watch. The
// runner (job-watch-runner) fills it as jobs start and end; the Camera
// panel's Watch the job section reads it.

import { create } from 'zustand';
import type { BurnReport } from '../../../core/camera/job-watch/burn-comparison';
import type { BedPicture } from '../../state/camera-store';
import {
  loadJobWatchSettings,
  saveJobWatchSettings,
  type JobWatchSettings,
} from './job-watch-settings';

export type TimelapseView = {
  readonly frames: ReadonlyArray<Blob>;
  readonly intervalMs: number;
  /** Frames are flat pictures of the job's part of the bed, not plain camera frames. */
  readonly flat: boolean;
  readonly recording: boolean;
  readonly note: string | null;
};

export type BurnCheckView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'watching' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'done'; readonly report: BurnReport; readonly picture: BedPicture }
  | { readonly kind: 'unavailable'; readonly reason: string };

type JobWatchStore = {
  readonly settings: JobWatchSettings;
  readonly timelapse: TimelapseView | null;
  readonly burnCheck: BurnCheckView;
  readonly setSettings: (patch: Partial<JobWatchSettings>) => void;
  readonly clearTimelapse: () => void;
};

export const useJobWatchStore = create<JobWatchStore>((set, get) => ({
  settings: loadJobWatchSettings(),
  timelapse: null,
  burnCheck: { kind: 'idle' },
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    saveJobWatchSettings(settings);
    set({ settings });
  },
  clearTimelapse: () => {
    if (get().timelapse?.recording !== true) set({ timelapse: null });
  },
}));

/** Whether the camera should keep running with its panel closed, to watch the next job. */
export function jobWatchWantsCamera(): boolean {
  const { settings, timelapse, burnCheck } = useJobWatchStore.getState();
  return (
    settings.timelapse ||
    settings.burnCheck ||
    timelapse?.recording === true ||
    burnCheck.kind === 'watching'
  );
}

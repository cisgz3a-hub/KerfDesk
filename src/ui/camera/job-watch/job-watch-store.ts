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
  /** Save video wrote it (ADR-490 Amendment 4): a new job may replace it. */
  readonly saved?: boolean;
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
  readonly markTimelapseSaved: () => void;
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
  markTimelapseSaved: () => {
    const timelapse = get().timelapse;
    if (timelapse !== null) set({ timelapse: { ...timelapse, saved: true } });
  },
}));

/**
 * A recording with frames that was neither saved nor cleared (ADR-490
 * Amendment 4; the maintainer's choice on camera audit v2 K4-P2-3, "Keep
 * until saved/dismissed"): no new run may empty it.
 */
export function unsavedTimelapse(timelapse: TimelapseView | null): timelapse is TimelapseView {
  return timelapse !== null && timelapse.frames.length > 0 && timelapse.saved !== true;
}

/** A timelapse will be wanted for the next job, but the last one would be kept. */
export function timelapseWouldBeKept(): boolean {
  const { settings, timelapse } = useJobWatchStore.getState();
  return settings.timelapse && unsavedTimelapse(timelapse);
}

export const KEPT_TIMELAPSE_NOTE =
  'This timelapse is not saved yet, so it was kept and the next job was not recorded. Save it (Save video) or clear it, and the next job records again.';

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

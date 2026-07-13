import { create } from 'zustand';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

export const DEFAULT_JOG_STEP_MM = 10;

type JogControlPreferences = {
  readonly stepMm: number;
  readonly requestedFeedMmPerMin: number;
  readonly setStepMm: (stepMm: number) => void;
  readonly setRequestedFeedMmPerMin: (feed: number) => void;
};

export const useJogControlPreferences = create<JogControlPreferences>((set) => ({
  stepMm: DEFAULT_JOG_STEP_MM,
  requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  setStepMm: (stepMm) => set({ stepMm }),
  setRequestedFeedMmPerMin: (requestedFeedMmPerMin) => set({ requestedFeedMmPerMin }),
}));

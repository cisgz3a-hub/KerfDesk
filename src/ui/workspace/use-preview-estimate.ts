import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useJobEstimate } from '../laser/use-job-estimate';
import { useStore } from '../state/store';

const MISSING_IMPORTED_TIMING: LiveJobEstimate = {
  kind: 'preparation-failed',
  message: 'Imported program timing is unavailable.',
};

/** A project estimate never describes the external route occupying Preview. */
export function usePreviewEstimate(): LiveJobEstimate {
  const projectEstimate = useJobEstimate();
  const external = useStore((state) => state.externalGcodePreview);
  return external === null
    ? projectEstimate
    : (external.timing?.estimate ?? MISSING_IMPORTED_TIMING);
}

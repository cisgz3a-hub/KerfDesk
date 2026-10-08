import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

type ControllerInformationActivity = Pick<
  LaserState,
  'controllerOperation' | 'motionOperation' | 'streamer' | 'fireActive' | 'autofocusBusy'
>;

/** Information-read failures do not turn normal machine work into orphaned
 * ownership. A terminal errored sender retains its debt but cannot refill. */
export function controllerInformationActivityIsBusy(state: ControllerInformationActivity): boolean {
  return (
    state.controllerOperation !== null ||
    state.motionOperation !== null ||
    (state.streamer?.status !== 'errored' && isActiveJob(state.streamer)) ||
    state.fireActive ||
    state.autofocusBusy
  );
}

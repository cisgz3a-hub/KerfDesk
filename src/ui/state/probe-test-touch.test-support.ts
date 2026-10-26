import { useLaserStore } from './laser-store';

/** A test touch in the current controller session, as a Pn:P report records
 * one (probe-test-touch.ts). Tests that probe call it after they connect. */
export function markProbeCircuitTested(): void {
  useLaserStore.setState((state) => ({
    probeTestTouch: { controllerSessionEpoch: state.controllerSessionEpoch },
  }));
}

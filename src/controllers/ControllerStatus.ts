/**
 * T1-230: neutral home for controller-reported status vocabulary.
 *
 * `ControllerStatus` is emitted by controllers and consumed by app safety
 * state. Keeping it in `src/controllers` prevents the lower controller layer
 * from importing `src/app/MachineSafetyState.ts` just to type status helpers.
 */

/** GRBL-style status string the controller reports today. */
export type ControllerStatus =
  | 'idle'
  | 'run'
  | 'hold'
  | 'jog'
  | 'alarm'
  | 'door'
  | 'check'
  | 'home'
  | 'sleep'
  | 'unknown';


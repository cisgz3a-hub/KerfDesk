// What KerfDesk can tell an operator to do when a controller's own air standby
// timer stops the pump mid-job (ADR-345, ADR-370 Amendment 1).
//
// Creality's Falcon A1 parameter page documents `$152` as the wait before the
// pump and laser module go to standby, 0-100 s with 100 = never, set from a
// software console. That is stock-GRBL numbering, which the A1 runs. The Falcon
// A1 Pro's own settings page lists no `$150`-`$152`, and its firmware is
// grblHAL, where they are the X, Y and Z microsteps: an A1 Pro `$I`/`$$`
// (barebaric/rayforge PR #461) reads `[PLUGIN:Trinamic v0.12]` and
// `$150=16 $151=16 $152=16`. There the advice would change how far a motor
// moves, or be refused, so it is named only for a Falcon on stock GRBL, where
// the Console can send it (rolling audit v5 J8-P3-2).
// https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/description-for-GRBL-configuration-parameters
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L553-L562

import type { DeviceProfile } from './device-profile';

export type AirStandbyRemedy =
  /** A Falcon on stock GRBL: the A1's `$152=100` from the Console, or a
   *  firmware update. */
  | 'standby-setting'
  /** A Falcon on grblHAL (the A1 Pro): a firmware update only; `$150`-`$152`
   *  are microstep settings there. */
  | 'grblhal-falcon'
  /** Any other controller: a firmware update only. */
  | 'firmware';

type RemedyDevice = Pick<
  DeviceProfile,
  'controllerKind' | 'controllerCommandSet' | 'machineFamily'
>;

/** The remedy for an air pump the controller idles mid-job on this device. */
export function airStandbyRemedy(device: RemedyDevice): AirStandbyRemedy {
  const falcon =
    device.controllerCommandSet === 'creality-falcon-a1-pro' ||
    device.machineFamily === 'creality-falcon';
  if (!falcon) return 'firmware';
  // Profiles without a kind are GRBL (select-controller-driver.ts).
  if (device.controllerKind === undefined || device.controllerKind === 'grbl-v1.1') {
    return 'standby-setting';
  }
  return device.controllerKind === 'grblhal' ? 'grblhal-falcon' : 'firmware';
}

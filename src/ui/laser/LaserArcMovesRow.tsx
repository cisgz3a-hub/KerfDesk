// ADR-432. On a controller family known to execute G2/G3 (GRBL 1.1, grblHAL,
// FluidNC), laser line cuts along curves can be written as native arcs. The
// switch starts at the profile's default (on for firmware-family profiles, off
// for brand machine profiles whose firmware build is not established) and is
// hidden where the output never carries arcs, so it cannot suggest a
// capability the machine lacks.

import {
  controllerAcceptsLaserArcs,
  laserArcMovesDefaultOn,
} from '../../core/devices/laser-arc-moves';
import type { DeviceProfile } from '../../core/devices';
import { Row } from './device-settings-shared';

type ArcMovesRowProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function LaserArcMovesRow({ device, update }: ArcMovesRowProps): JSX.Element | null {
  if (!controllerAcceptsLaserArcs(device)) return null;
  const defaultOn = laserArcMovesDefaultOn(device);
  const checked = device.laserArcMoves === undefined ? defaultOn : device.laserArcMoves === 'on';
  const rotary = device.rotary?.enabled === true;
  return (
    <Row label="Arc moves">
      <input
        type="checkbox"
        checked={checked}
        disabled={rotary}
        aria-label="Write curves as G2/G3 arc moves"
        title="Line cuts along curves are written as G2/G3 arcs within the 0.025 mm machine curve tolerance, so there are fewer lines and bytes to send. Untick to write every burn move as a G1 line, for example if your controller firmware rejects arcs. Brand machine profiles start with this off because their firmware build is not established."
        onChange={(event) => {
          const wanted = event.target.checked;
          update({ laserArcMoves: wanted === defaultOn ? undefined : wanted ? 'on' : 'off' });
        }}
      />
      <span style={{ opacity: 0.7 }}>
        {rotary ? 'G1 lines only while the rotary is enabled' : 'write curves as G2/G3 arcs'}
      </span>
    </Row>
  );
}

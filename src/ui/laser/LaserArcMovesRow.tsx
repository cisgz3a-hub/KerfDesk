// ADR-407. On a controller known to execute G2/G3 (GRBL 1.1, grblHAL,
// FluidNC), laser line cuts along curves are written as native arcs. This is
// the operator's switch back to G1 lines only; it is hidden where the output
// never carries arcs, so it cannot suggest a capability the machine lacks.

import { controllerAcceptsLaserArcs } from '../../core/devices/laser-arc-moves';
import type { DeviceProfile } from '../../core/devices';
import { Row } from './device-settings-shared';

type ArcMovesRowProps = {
  readonly device: DeviceProfile;
  readonly update: (patch: Partial<DeviceProfile>) => void;
};

export function LaserArcMovesRow({ device, update }: ArcMovesRowProps): JSX.Element | null {
  if (!controllerAcceptsLaserArcs(device)) return null;
  return (
    <Row label="Arc moves">
      <input
        type="checkbox"
        checked={device.laserArcMoves !== 'off'}
        aria-label="Write curves as G2/G3 arc moves"
        title="Line cuts along curves are written as G2/G3 arcs within the 0.025 mm machine curve tolerance: fewer lines to send and smoother motion. Untick to write every burn move as a G1 line, for example if your controller firmware rejects arcs. A rotary always gets G1 lines."
        onChange={(event) =>
          update(event.target.checked ? { laserArcMoves: undefined } : { laserArcMoves: 'off' })
        }
      />
      <span style={{ opacity: 0.7 }}>write curves as G2/G3 arcs</span>
    </Row>
  );
}

// Recovery jobs plunge every pass from safe Z (ADR-489).
//
// A pass's air floor holds only once every pass before it has cut. A recovery
// job starts at a boundary the operator confirms, and the wizard lets them
// pick a later pass than the evidence proves. Rapiding down onto stock that
// was never cut would hit it at rapid speed, where a plunge from safe Z only
// cuts it at the plunge feed, as recovery always has. So recovery keeps the
// plunge and drops every floor.

import type { CncGroup, CncPass } from '../job';

export function withoutAirFloors(group: CncGroup): CncGroup {
  if (!group.passes.some(hasAirFloor)) return group;
  return { ...group, passes: group.passes.map(stripAirFloor) };
}

function hasAirFloor(pass: CncPass): boolean {
  return 'airFloorZMm' in pass;
}

function stripAirFloor(pass: CncPass): CncPass {
  if (pass.kind === 'helical-contour' || !hasAirFloor(pass)) return pass;
  const { airFloorZMm: _floor, ...rest } = pass;
  return rest;
}

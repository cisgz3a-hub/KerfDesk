export type CncWrapCapability = {
  readonly id: 'grblhal-degrees-g93-reference-v1';
  readonly controllerFamily: 'grblHAL';
  readonly rotaryAxis: 'A';
  readonly rotaryUnits: 'degrees';
  readonly feedMode: 'G93-per-block';
  readonly workCoordinateSystem: 'G54';
  readonly radialZDatum: 'cylinder-surface';
  readonly strategies: readonly ['profile-on-path'];
  readonly qualification: 'reference-model-only';
  readonly machineOutputAvailable: false;
  readonly upstreamReferences: readonly string[];
};
export const CNC_WRAP_REFERENCE_CAPABILITY: CncWrapCapability = {
  id: 'grblhal-degrees-g93-reference-v1',
  controllerFamily: 'grblHAL',
  rotaryAxis: 'A',
  rotaryUnits: 'degrees',
  feedMode: 'G93-per-block',
  workCoordinateSystem: 'G54',
  radialZDatum: 'cylinder-surface',
  strategies: ['profile-on-path'],
  qualification: 'reference-model-only',
  machineOutputAvailable: false,
  upstreamReferences: [
    'https://github.com/grblHAL/core/blob/master/gcode.h',
    'https://github.com/grblHAL/grblhal_docs/blob/main/content/markdown/04-Reference/02-complete-gcode-and-mcode-reference.md',
  ],
};
export function cncWrapOutputAvailability(capabilityId: string): {
  readonly available: false;
  readonly reason: string;
} {
  return {
    available: false,
    reason:
      capabilityId === CNC_WRAP_REFERENCE_CAPABILITY.id
        ? 'Reference mapping is available. Rotary machine output requires an exact controller/firmware simulator record and machine/accessory qualification.'
        : 'This post has no declared and qualified CNC wrapping capability.',
  };
}

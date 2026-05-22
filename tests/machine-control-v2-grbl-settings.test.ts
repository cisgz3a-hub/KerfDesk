import {
  parseGrblDollarSettings,
  toControllerProfile,
} from '../src/machine-control-v2/grbl/GrblSettingsModel';

const settings = parseGrblDollarSettings([
  '$20=1',
  '$22=1',
  '$30=1000',
  '$31=0',
  '$32=1',
  '$110=6000',
  '$111=5000',
  '$112=800',
  '$130=400',
  '$131=300',
  '$132=50',
]);

const profile = toControllerProfile({
  family: 'grbl',
  firmwareVersion: '1.1h',
  settings,
});

if (!profile.softLimitsEnabled) {
  throw new Error('soft limits should be true');
}
if (!profile.homingEnabled) {
  throw new Error('homing should be true');
}
if (!profile.laserModeEnabled) {
  throw new Error('laser mode should be true');
}
if (profile.spindleMax !== 1000) {
  throw new Error('spindle max should be 1000');
}
if (
  profile.travelMm.X !== 400 ||
  profile.travelMm.Y !== 300 ||
  profile.travelMm.Z !== 50
) {
  throw new Error(`wrong travel: ${JSON.stringify(profile.travelMm)}`);
}
if (
  profile.maxFeedMmPerMin.X !== 6000 ||
  profile.maxFeedMmPerMin.Y !== 5000
) {
  throw new Error(`wrong feed: ${JSON.stringify(profile.maxFeedMmPerMin)}`);
}

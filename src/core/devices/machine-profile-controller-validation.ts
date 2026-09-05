import { isGrblRxBufferBytes, isGrblStreamingMode } from '../grbl-streaming';
import { controllerSupportsGcodeDialect } from './controller-profile-compatibility';
import { isStreamingModeCompatible } from './controller-streaming-mode';
import {
  isBidirectionalScanPolicy,
  isKnownControllerKind,
  type DeviceProfile,
} from './device-profile';
import { isGcodeDialectSelection } from './gcode-dialects';

export function machineProfileControllerIssues(profile: DeviceProfile): ReadonlyArray<string> {
  return [
    ...controllerKindIssues(profile),
    ...dialectIssues(profile),
    ...scanPolicyIssues(profile),
    ...streamingIssues(profile),
    ...receiveWindowIssues(profile),
  ];
}

function controllerKindIssues(profile: DeviceProfile): ReadonlyArray<string> {
  if (profile.controllerKind === undefined || isKnownControllerKind(profile.controllerKind)) {
    return [];
  }
  return [
    'controllerKind must be one of: grbl-v1.1, grblhal, fluidnc, marlin, smoothieware, ruida',
  ];
}

function dialectIssues(profile: DeviceProfile): ReadonlyArray<string> {
  if (!isGcodeDialectSelection(profile.gcodeDialect)) {
    return ['gcodeDialect must reference a known GRBL dialect'];
  }
  return controllerSupportsGcodeDialect(profile.controllerKind, profile.gcodeDialect.dialectId)
    ? []
    : [
        `${profile.gcodeDialect.dialectId} is not compatible with ${profile.controllerKind ?? 'grbl-v1.1'}`,
      ];
}

function scanPolicyIssues(profile: DeviceProfile): ReadonlyArray<string> {
  return profile.bidirectionalScanPolicy === undefined ||
    isBidirectionalScanPolicy(profile.bidirectionalScanPolicy)
    ? []
    : ['bidirectionalScanPolicy must be allow-requested or require-verified-offsets'];
}

function streamingIssues(profile: DeviceProfile): ReadonlyArray<string> {
  if (!isGrblStreamingMode(profile.streamingMode)) {
    return ['streamingMode must be char-counted or ping-pong'];
  }
  return isStreamingModeCompatible(profile.controllerKind, profile.streamingMode)
    ? []
    : [`${profile.controllerKind} requires ping-pong streaming`];
}

function receiveWindowIssues(profile: DeviceProfile): ReadonlyArray<string> {
  return isGrblRxBufferBytes(profile.rxBufferBytes)
    ? []
    : ['rxBufferBytes must be a positive integer not greater than 4096'];
}

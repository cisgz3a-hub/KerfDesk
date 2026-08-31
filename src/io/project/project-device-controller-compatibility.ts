import {
  controllerCompatibleProfile,
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
} from '../../core/devices';

type ControllerCompatibleFields = Pick<
  DeviceProfile,
  'streamingMode' | 'rxBufferBytes' | 'gcodeDialect'
>;

export function projectDeviceControllerCompatibleFields(
  fields: ControllerCompatibleFields & { readonly controllerKind?: ControllerKind },
): ControllerCompatibleFields {
  const profile = controllerCompatibleProfile(
    { ...DEFAULT_DEVICE_PROFILE, ...fields },
    fields.controllerKind,
  ).profile;
  return {
    streamingMode: profile.streamingMode,
    rxBufferBytes: profile.rxBufferBytes,
    gcodeDialect: profile.gcodeDialect,
  };
}

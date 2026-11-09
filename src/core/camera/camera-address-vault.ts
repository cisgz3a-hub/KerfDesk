// The remembered RTSP camera address in full, kept only in the operating
// system's secure storage (ADR-692). Desktop only; `write` resolves false when
// nothing could be kept there, and null forgets it.
export type CameraAddressVault = {
  readonly read: () => Promise<string | null>;
  readonly write: (address: string | null) => Promise<boolean>;
};

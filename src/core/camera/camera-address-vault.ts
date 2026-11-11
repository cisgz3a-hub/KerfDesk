// The remembered network camera addresses that need more than their public
// form to reconnect, kept only in the operating system's secure storage
// (ADR-692 and Amendment 1): the RTSP address in full, and the phone camera's
// address without its login (ADR-448). Desktop only; `write` resolves false
// when nothing could be kept there, and null forgets it.
export type CameraAddressSlot = 'rtsp' | 'phone';

export type CameraAddressVault = {
  readonly read: (slot: CameraAddressSlot) => Promise<string | null>;
  readonly write: (slot: CameraAddressSlot, address: string | null) => Promise<boolean>;
};

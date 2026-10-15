/** These channels are separate wire protocols even when both use TCP port 23. */
export type MachineNetworkProtocol = 'fluidnc-telnet' | 'grblhal-raw';

export function validateMachineNetworkProtocol(
  protocol: unknown,
): asserts protocol is MachineNetworkProtocol {
  if (protocol !== 'fluidnc-telnet' && protocol !== 'grblhal-raw')
    throw new Error('Only the documented FluidNC Telnet or grblHAL raw TCP channel is supported.');
}

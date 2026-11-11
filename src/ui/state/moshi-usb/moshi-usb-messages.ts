// Texts the Moshi USB panel and store show (ADR-705).

export const MOSHI_NOT_QUALIFIED =
  'Experimental: simulator-tested only, not qualified on hardware. Keep a hand on the machine’s stop switch.';

export const MOSHI_POWER_NOTE =
  'A Moshiboard has no software power control: set the power on the machine. Layer power above 0 only switches the beam on.';

export const MOSHI_FRAME_FIRST =
  'Frame this job first: Start runs only the footprint a completed Frame on this connection traced.';

export const MOSHI_ABORT_SENT =
  'Estop sent; the board dropped its program. Frame again before the next Start.';

export const MOSHI_ABORT_FAILED =
  'The estop could not be sent over USB. Stop the machine with its own switch.';

export function moshiDisconnectedMessage(active: boolean): string {
  return active
    ? 'The Moshiboard disconnected during a run. A program it holds may still be running — stop it with the machine’s switch.'
    : 'The Moshiboard disconnected.';
}

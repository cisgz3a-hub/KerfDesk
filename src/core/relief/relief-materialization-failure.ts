/** Compile-integrity failure produced when a stored relief source cannot become a heightmap. */
export type ReliefMaterializationFailure = {
  readonly kind: 'relief-materialization-failed';
  readonly source: string;
  readonly reason: string;
};

/** Build the shared failure value propagated from pure CAM into the I/O warning boundary. */
export function reliefMaterializationFailure(
  source: string,
  reason: string,
): ReliefMaterializationFailure {
  return { kind: 'relief-materialization-failed', source, reason };
}

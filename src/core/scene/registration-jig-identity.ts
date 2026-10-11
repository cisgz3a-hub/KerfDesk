export const MAX_REGISTRATION_JIG_ANCESTORS = 100_000;

export type RegistrationJigIdentity = {
  readonly objectId: string;
  readonly boxId: string;
  /** Nearest parent first; retained even when intermediate artwork is deleted. */
  readonly ancestors: ReadonlyArray<{
    readonly sourceId: string;
    readonly kind: 'copy' | 'part';
  }>;
};

/**
 * Gives one ready service-worker epoch exactly one reload attempt. Rapid
 * clicks share the same promise rather than posting duplicate SKIP_WAITING
 * messages or scheduling independent reloads. A failed attempt releases
 * ownership so the still-visible Update button can be tried again.
 */
export function createRetryableUpdateApplyOwner(
  apply: () => Promise<void>,
  reportFailure: (error: unknown) => void,
): () => Promise<void> {
  let claimed: Promise<void> | null = null;

  return () => {
    if (claimed !== null) return claimed;

    const owned = Promise.resolve()
      .then(apply)
      .catch((error: unknown) => {
        if (claimed === owned) claimed = null;
        reportFailure(error);
      });
    claimed = owned;
    return owned;
  };
}

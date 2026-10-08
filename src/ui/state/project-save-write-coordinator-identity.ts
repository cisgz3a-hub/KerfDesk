import type { SaveDestinationComparison, SaveTarget } from '../../platform/types';

export async function saveTargetsShareDestination(
  left: SaveTarget,
  right: SaveTarget,
): Promise<boolean> {
  return (await compareSaveDestinations(left, right)) === 'same';
}

export function compareSaveDestinations(
  left: SaveTarget,
  right: SaveTarget,
): Promise<SaveDestinationComparison> {
  if (
    left === right ||
    (left.destinationIdentity !== undefined &&
      right.destinationIdentity !== undefined &&
      Object.is(left.destinationIdentity, right.destinationIdentity))
  )
    return Promise.resolve('same');
  const comparisons = [reportsDestination(left, right), reportsDestination(right, left)];
  return new Promise((resolve) => {
    let remaining = comparisons.length;
    let provedDifferent = false;
    for (const comparison of comparisons) {
      void comparison.then((result) => {
        if (result === 'same') {
          resolve('same');
          return;
        }
        if (result === 'different') provedDifferent = true;
        remaining -= 1;
        if (remaining === 0) resolve(provedDifferent ? 'different' : 'unknown');
      });
    }
  });
}

async function reportsDestination(
  left: SaveTarget,
  right: SaveTarget,
): Promise<SaveDestinationComparison> {
  try {
    const comparison = await left.compareDestination?.(right);
    if (comparison === 'same' || comparison === 'different') return comparison;
    // Legacy booleans prove sameness only. False also meant unsupported
    // carriers and unresolved aliases, so it cannot establish distinction.
    return (await left.isSameDestination?.(right)) === true ? 'same' : 'unknown';
  } catch {
    return 'unknown';
  }
}

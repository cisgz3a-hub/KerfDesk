import { beforeEach, describe, expect, it } from 'vitest';
import {
  isVariableCsvImportClaimCurrent,
  useVariableCsvImportOwner,
} from './use-variable-csv-import-owner';

beforeEach(() => {
  useVariableCsvImportOwner.setState({ owner: { kind: 'idle', requestEpoch: 0 } });
});

describe('variable CSV import owner', () => {
  it('does not let another component retire the active owner', () => {
    const firstOwner = Symbol('first');
    const claim = useVariableCsvImportOwner.getState().claim(firstOwner, 7);

    useVariableCsvImportOwner.getState().retire(Symbol('second'));
    expect(isVariableCsvImportClaimCurrent(claim, 7)).toBe(true);

    useVariableCsvImportOwner.getState().retire(firstOwner);
    expect(isVariableCsvImportClaimCurrent(claim, 7)).toBe(false);
  });

  it('lets a newer component claim global latest-request ownership', () => {
    const firstClaim = useVariableCsvImportOwner.getState().claim(Symbol('first'), 9);
    const secondClaim = useVariableCsvImportOwner.getState().claim(Symbol('second'), 9);

    expect(isVariableCsvImportClaimCurrent(firstClaim, 9)).toBe(false);
    expect(isVariableCsvImportClaimCurrent(secondClaim, 9)).toBe(true);
    expect(isVariableCsvImportClaimCurrent(secondClaim, 10)).toBe(false);
  });

  it('makes an older picker from the same component stale', () => {
    const ownerId = Symbol('same-component');
    const firstClaim = useVariableCsvImportOwner.getState().claim(ownerId, 12);
    const secondClaim = useVariableCsvImportOwner.getState().claim(ownerId, 12);

    expect(isVariableCsvImportClaimCurrent(firstClaim, 12)).toBe(false);
    expect(isVariableCsvImportClaimCurrent(secondClaim, 12)).toBe(true);
  });
});

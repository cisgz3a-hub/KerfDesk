import type { CncWrapStudy } from './cnc-wrap-study';
import type { CncTwoSidedSetup } from './cnc-two-sided-setup';
/** Retained active setup. Stock, tools and machine parameters remain in MachineConfig. */
export type CncSetupFixture = {
  readonly id: string;
  readonly name: string;
  /** Rectangular fixture footprint in the emitted program's G54 work coordinates. */
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bottomZMm: number;
  readonly topZMm: number;
};

export type CncMachiningSetup = {
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly twoSided?: CncTwoSidedSetup;
  readonly wrapStudy?: CncWrapStudy;
  readonly wcs: 'G54';
  readonly zDatum: 'stock-top';
  readonly fixtures: ReadonlyArray<CncSetupFixture>;
};

export function defaultCncMachiningSetup(): CncMachiningSetup {
  return {
    id: 'cnc-setup-1',
    name: 'Setup 1',
    notes: '',
    wcs: 'G54',
    zDatum: 'stock-top',
    fixtures: [],
  };
}

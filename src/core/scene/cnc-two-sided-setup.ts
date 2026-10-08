import type { Vec2 } from './scene-object';
/** Side A uses the canonical stock origin. Each side is touched off at its own top Z0. */
export type CncTwoSidedSetup = {
  readonly activeSide: 'A' | 'B';
  /** Physical flip around X mirrors Y; flip around Y mirrors X. */
  readonly flipAxis: 'x' | 'y';
  readonly sideBStockOriginMm: Vec2;
  readonly sideAObjectIds: ReadonlyArray<string>;
  readonly sideBObjectIds: ReadonlyArray<string>;
  readonly registration: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly stockXMm: number;
    readonly stockYMm: number;
    readonly diameterMm: number;
  }>;
};

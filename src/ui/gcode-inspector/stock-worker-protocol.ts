// Messages between the carved stock view and its worker (ADR-487).

import type { InspectionRelief } from './inspection-design';
import type { StockLayout, StockMoves, StockTarget } from './stock-carving';
import type { StockComparison } from './stock-compare';
import type { StockStl } from './stock-stl';

/** What the project says about the stock, when the program is the project's. */
export type StockDesign = {
  readonly thicknessMm?: number;
  readonly reliefs: ReadonlyArray<InspectionRelief>;
};

export type StockWorkerRequest =
  | { readonly kind: 'start'; readonly moves: StockMoves; readonly design?: StockDesign }
  | {
      readonly kind: 'carve';
      readonly target: StockTarget;
      /** Compare the carving with the design within this tolerance; null does not. */
      readonly toleranceMm: number | null;
    }
  /** The stock as far as it is carved, as an STL solid. */
  | { readonly kind: 'stl' };

export type StockWorkerResponse =
  | {
      readonly kind: 'ready';
      readonly layout: StockLayout;
      readonly columns: number;
      readonly rows: number;
      /** The design's depth in each cell (stock-design-target.ts); null without one. */
      readonly design: Float32Array | null;
    }
  /** The program never goes below the stock top. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'carved';
      readonly target: StockTarget;
      readonly firstRow: number;
      /** The changed rows' depths, row by row; empty when nothing changed. */
      readonly depth: Float32Array;
      /** How the whole stock compares with the design, when asked and there is one. */
      readonly comparison: StockComparison | null;
    }
  /** Null when nothing of the stock is left. */
  | { readonly kind: 'stl'; readonly stl: StockStl | null };

/** What the view hears: all but the STL, which goes back to whoever asked. */
export type StockViewResponse = Exclude<StockWorkerResponse, { readonly kind: 'stl' }>;

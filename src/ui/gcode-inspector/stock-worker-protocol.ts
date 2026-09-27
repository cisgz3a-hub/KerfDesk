// Messages between the carved stock view and its worker (ADR-487).

import type { StockLayout, StockMoves, StockTarget } from './stock-carving';

export type StockWorkerRequest =
  | { readonly kind: 'start'; readonly moves: StockMoves }
  | { readonly kind: 'carve'; readonly target: StockTarget };

export type StockWorkerResponse =
  | {
      readonly kind: 'ready';
      readonly layout: StockLayout;
      readonly columns: number;
      readonly rows: number;
    }
  /** The program never goes below the stock top. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'carved';
      readonly target: StockTarget;
      readonly firstRow: number;
      /** The changed rows' depths, row by row; empty when nothing changed. */
      readonly depth: Float32Array;
    };

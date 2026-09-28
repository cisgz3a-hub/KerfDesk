// Messages between the burn preview and its worker (ADR-487).

import type { BurnLaser, BurnLayout, BurnMoves } from './burn-grid';
import type { StockTarget } from './stock-carving';

export type BurnWorkerRequest =
  | { readonly kind: 'start'; readonly moves: BurnMoves; readonly laser: BurnLaser }
  | { readonly kind: 'burn'; readonly target: StockTarget };

export type BurnWorkerResponse =
  | { readonly kind: 'ready'; readonly layout: BurnLayout }
  /** The program burns nothing. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'burned';
      readonly target: StockTarget;
      readonly firstRow: number;
      /** The changed rows' darkness, row by row; empty when nothing changed. */
      readonly darkness: Uint8Array;
    };

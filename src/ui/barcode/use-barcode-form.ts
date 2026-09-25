import { useState } from 'react';
import type { BarcodeShape, BarcodeSymbology } from '../../core/barcode';
import { draftFromSpec, draftWithSymbology, type BarcodeDraft } from './barcode-form';

export type BarcodeForm = {
  readonly draft: BarcodeDraft;
  readonly setField: <K extends keyof BarcodeDraft>(field: K, value: BarcodeDraft[K]) => void;
  readonly setSymbology: (symbology: BarcodeSymbology) => void;
  /** Appends a variable field such as {{serial:4}} to the data. */
  readonly insertField: (source: string) => void;
};

export function useBarcodeForm(initial: BarcodeShape): BarcodeForm {
  const [draft, setDraft] = useState(() => draftFromSpec(initial));
  return {
    draft,
    setField: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
    setSymbology: (symbology) => setDraft((current) => draftWithSymbology(current, symbology)),
    insertField: (source) => setDraft((current) => ({ ...current, data: current.data + source })),
  };
}

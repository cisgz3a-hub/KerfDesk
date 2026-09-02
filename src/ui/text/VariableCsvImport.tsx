import { useEffect, useRef, useState } from 'react';
import type { VariableCsvDataset } from '../../core/scene';
import { parseVariableCsv } from '../../core/variables';
import { Button } from '../kit';
import { useStore, type useToastStore } from '../state';
import {
  isVariableCsvImportClaimCurrent,
  useVariableCsvImportOwner,
  type VariableCsvImportClaim,
} from './use-variable-csv-import-owner';

type VariableCsvImportProps = {
  readonly setCsv: (csv: VariableCsvDataset | undefined) => void;
  readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
};

/** Renders the variable-data CSV picker with exact request and document ownership. */
export function VariableCsvImport(props: VariableCsvImportProps): JSX.Element {
  const [ownerId] = useState(() => Symbol('variable-csv-import'));
  const pickerHostRef = useRef<HTMLSpanElement>(null);
  useEffect(() => () => useVariableCsvImportOwner.getState().retire(ownerId), [ownerId]);

  return (
    <>
      <Button onClick={() => openVariableCsvPicker(pickerHostRef.current, ownerId, props)}>
        Import CSV...
      </Button>
      <span ref={pickerHostRef} hidden aria-hidden="true" />
    </>
  );
}

function openVariableCsvPicker(
  host: HTMLSpanElement | null,
  ownerId: symbol,
  props: VariableCsvImportProps,
): void {
  if (host === null) return;
  const claim = useVariableCsvImportOwner
    .getState()
    .claim(ownerId, useStore.getState().projectDocumentEpoch);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.hidden = true;
  input.title = 'Choose a CSV file to embed in this project.';
  input.setAttribute('aria-label', 'Import variable CSV');
  input.addEventListener('change', () => completeVariableCsvPicker(input, claim, props), {
    once: true,
  });
  input.addEventListener('cancel', () => input.remove(), { once: true });
  host.append(input);
  input.click();
}

function completeVariableCsvPicker(
  input: HTMLInputElement,
  claim: VariableCsvImportClaim,
  props: VariableCsvImportProps,
): void {
  const file = input.files?.[0];
  input.remove();
  if (file === undefined || !isClaimCurrent(claim)) return;
  void importVariableCsv(file, claim, props);
}

async function importVariableCsv(
  file: File,
  claim: VariableCsvImportClaim,
  props: VariableCsvImportProps,
): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    if (!isClaimCurrent(claim)) return;
    props.pushToast(`Could not read ${file.name}: ${errorMessage(error)}`, 'error');
    return;
  }
  if (!isClaimCurrent(claim)) return;
  const result = parseVariableCsv(file.name, text);
  if (!result.ok) {
    props.pushToast(`${result.message} Row ${result.row}, column ${result.column}.`, 'error');
    return;
  }
  props.setCsv(result.dataset);
  props.pushToast(`Embedded ${result.dataset.records.length} CSV record(s).`, 'success');
}

function isClaimCurrent(claim: VariableCsvImportClaim): boolean {
  return isVariableCsvImportClaimCurrent(claim, useStore.getState().projectDocumentEpoch);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// BarcodeFields — the barcode dialog's inputs (ADR-372): type, data with
// optional variable fields, error correction for QR Code, size, quiet zone,
// invert and human-readable text. Fields a type does not use are hidden.

import type { CSSProperties } from 'react';
import {
  BARCODE_SYMBOLOGY_LABELS,
  isMatrixSymbology,
  type BarcodeShape,
  type BarcodeSymbology,
} from '../../core/barcode';
import { Field, NumberInput } from '../kit';
import { VariableTextFields } from '../text/VariableTextFields';
import type { BarcodeDraft, BarcodeNumberField } from './barcode-form';
import type { BarcodeForm } from './use-barcode-form';

const DATA_HINTS: Readonly<Record<BarcodeSymbology, string>> = {
  qr: 'Any text or a URL. Longer data makes a larger code.',
  'data-matrix': 'Text in Latin-1 characters.',
  code128: 'Printable ASCII text.',
  code39: 'Capital letters, digits, space and - . $ / + %.',
  ean13: '12 digits; the check digit is added. 13 digits are checked.',
  upca: '11 digits; the check digit is added. 12 digits are checked.',
  ean8: '7 digits; the check digit is added. 8 digits are checked.',
};

const ERROR_CORRECTION: ReadonlyArray<readonly [BarcodeShape['errorCorrection'], string]> = [
  ['L', 'L: recovers 7%'],
  ['M', 'M: recovers 15%'],
  ['Q', 'Q: recovers 25%'],
  ['H', 'H: recovers 30%'],
];

export function BarcodeFields(props: { readonly form: BarcodeForm }): JSX.Element {
  const { draft, setField, setSymbology } = props.form;
  return (
    <div style={stackStyle}>
      <Field label="Type" labelWidth="md">
        <select
          className="lf-input"
          aria-label="Barcode type"
          title="Choose the barcode or 2D code to generate."
          value={draft.symbology}
          onChange={(event) => setSymbology(event.currentTarget.value as BarcodeSymbology)}
        >
          {Object.entries(BARCODE_SYMBOLOGY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <DataField form={props.form} />
      {draft.symbology === 'qr' ? (
        <Field label="Error correction" labelWidth="md">
          <select
            className="lf-input"
            aria-label="Error correction"
            title="Higher levels survive more damage but make a larger code."
            value={draft.errorCorrection}
            onChange={(event) =>
              setField(
                'errorCorrection',
                event.currentTarget.value as BarcodeDraft['errorCorrection'],
              )
            }
          >
            {ERROR_CORRECTION.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <SizeFields form={props.form} />
      <OptionFields form={props.form} />
    </div>
  );
}

function DataField(props: { readonly form: BarcodeForm }): JSX.Element {
  const { draft, setField, insertField } = props.form;
  return (
    <>
      <Field label="Data" labelWidth="md">
        <textarea
          className="lf-input"
          aria-label="Barcode data"
          title={DATA_HINTS[draft.symbology]}
          rows={2}
          spellCheck={false}
          value={draft.data}
          onChange={(event) => setField('data', event.currentTarget.value)}
          style={dataStyle}
        />
      </Field>
      <p style={hintStyle}>{DATA_HINTS[draft.symbology]}</p>
      <VariableTextFields
        label="Variable data"
        enabled={draft.variable}
        onEnabledChange={(enabled) => setField('variable', enabled)}
        onInsert={insertField}
      />
    </>
  );
}

function SizeFields(props: { readonly form: BarcodeForm }): JSX.Element {
  const { draft, setField } = props.form;
  const sizeField: BarcodeNumberField = draft.sizeMode === 'module' ? 'moduleMm' : 'widthMm';
  return (
    <>
      <Field label="Size by" labelWidth="md">
        <select
          className="lf-input"
          aria-label="Size by"
          title="Set the module (narrowest bar or square) size, or the overall width including quiet zones."
          value={draft.sizeMode}
          onChange={(event) =>
            setField('sizeMode', event.currentTarget.value as BarcodeDraft['sizeMode'])
          }
        >
          <option value="module">Module size</option>
          <option value="width">Overall width</option>
        </select>
      </Field>
      <NumberField
        form={props.form}
        field={sizeField}
        label={sizeField === 'moduleMm' ? 'Module size' : 'Overall width'}
        unit="mm"
      />
      {isMatrixSymbology(draft.symbology) ? null : (
        <NumberField form={props.form} field="barHeightMm" label="Bar height" unit="mm" />
      )}
      <NumberField form={props.form} field="quietZoneModules" label="Quiet zone" unit="modules" />
    </>
  );
}

function NumberField(props: {
  readonly form: BarcodeForm;
  readonly field: BarcodeNumberField;
  readonly label: string;
  readonly unit: string;
}): JSX.Element {
  return (
    <Field label={props.label} labelWidth="md" unit={props.unit}>
      <NumberInput
        aria-label={props.label}
        step="any"
        min={0}
        value={props.form.draft[props.field]}
        onChange={(event) => props.form.setField(props.field, event.currentTarget.value)}
      />
    </Field>
  );
}

function OptionFields(props: { readonly form: BarcodeForm }): JSX.Element {
  const { draft, setField } = props.form;
  return (
    <div style={optionRowStyle}>
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={draft.invert}
          title="Engrave the light modules and quiet zone instead, for stock that marks lighter than its surface such as anodised aluminium or slate."
          onChange={(event) => setField('invert', event.currentTarget.checked)}
        />
        Invert (engrave the light modules)
      </label>
      {isMatrixSymbology(draft.symbology) ? null : (
        <label style={checkStyle}>
          <input
            type="checkbox"
            checked={draft.showText}
            title="Print the encoded characters under the bars."
            onChange={(event) => setField('showText', event.currentTarget.checked)}
          />
          Show text
        </label>
      )}
    </div>
  );
}

const stackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const dataStyle: CSSProperties = { flex: 1, resize: 'vertical', fontFamily: 'var(--lf-font-mono)' };
const hintStyle: CSSProperties = {
  fontSize: 'var(--lf-text-xs)',
  color: 'var(--lf-text-muted)',
  margin: 0,
};
const optionRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };
const checkStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

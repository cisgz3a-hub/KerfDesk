export type VariableDateTimeFormat = 'date-iso' | 'time-24h' | 'datetime-iso';
export type VariableCutSettingField = 'power-percent' | 'speed-mm-min' | 'passes' | 'air-assist';

export type VariableTemplateToken =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'date-time'; readonly format: VariableDateTimeFormat }
  | {
      readonly kind: 'serial';
      readonly prefix: string;
      readonly width: number;
      readonly offset?: number;
    }
  | { readonly kind: 'csv'; readonly column: string }
  | { readonly kind: 'cut-setting'; readonly field: VariableCutSettingField };

export type VariableTemplate = { readonly tokens: readonly VariableTemplateToken[] };

export type VariableCsvDataset = {
  readonly sourceName: string;
  readonly headers: readonly string[];
  readonly records: readonly (readonly string[])[];
};

export type VariableAdvancementPolicy =
  | 'manual'
  | 'after-successful-stream'
  | 'after-successful-export';

export type ProjectVariableData = {
  readonly csv?: VariableCsvDataset;
  readonly recordIndex: number;
  readonly serialValue: number;
  readonly advancement: VariableAdvancementPolicy;
};

export const DEFAULT_PROJECT_VARIABLE_DATA: ProjectVariableData = {
  recordIndex: 0,
  serialValue: 1,
  advancement: 'manual',
};

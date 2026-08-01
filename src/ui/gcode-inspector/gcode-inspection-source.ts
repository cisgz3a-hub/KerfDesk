export type GcodeInspectionSource =
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string };

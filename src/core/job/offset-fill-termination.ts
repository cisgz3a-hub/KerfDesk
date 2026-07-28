/** Why Follow Shape stopped producing inward-offset contours. */
export type OffsetFillTermination =
  | { readonly kind: 'complete' }
  | { readonly kind: 'offset-failed' }
  | { readonly kind: 'pass-limit'; readonly passLimit: number };

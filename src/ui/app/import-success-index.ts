export function claimImportSuccessIndex(
  external: (() => number) | undefined,
  localIndex: number,
): { readonly batchIndex: number; readonly nextLocalIndex: number } {
  return external === undefined
    ? { batchIndex: localIndex, nextLocalIndex: localIndex + 1 }
    : { batchIndex: external(), nextLocalIndex: localIndex };
}

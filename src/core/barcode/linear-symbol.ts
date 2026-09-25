// Shared result shape of the 1D encoders: the bar/space module sequence plus
// where the human-readable text goes. Positions count modules from the
// leading edge of the first bar; text may sit in the quiet zone (EAN-13's
// leading digit does), so spans can start below zero.

export type LinearTextRun = {
  readonly text: string;
  /** Module span the text is centred in. */
  readonly fromModule: number;
  readonly toModule: number;
  /** Outer UPC-A digits are set smaller than the others. */
  readonly small?: boolean;
};

export type LinearSymbol = {
  /** '1' = bar module, '0' = space module; starts and ends with a bar. */
  readonly modules: string;
  /** Bars (by first module) that extend down beside the text, EAN/UPC guards. */
  readonly extendedBars: ReadonlySet<number>;
  /** Minimum quiet zone either side, in modules. */
  readonly quietZoneModules: number;
  readonly text: readonly LinearTextRun[];
};

export type LinearEncodeResult =
  | { readonly ok: true; readonly symbol: LinearSymbol }
  | { readonly ok: false; readonly message: string };

/** Expands bar/space widths (bar first) into module characters. */
export function widthsToModules(widths: string): string {
  let modules = '';
  for (let index = 0; index < widths.length; index += 1) {
    modules += (index % 2 === 0 ? '1' : '0').repeat(Number(widths[index]));
  }
  return modules;
}

/** Human-readable form: control characters shown as spaces. */
export function printableText(text: string): string {
  return Array.from(text, (char) => ((char.codePointAt(0) ?? 0) < 32 ? ' ' : char)).join('');
}

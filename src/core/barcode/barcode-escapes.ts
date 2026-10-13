// Control characters in barcode data (LightBurn's "process escape sequences"):
// with the option on, \n \r \t \\ and \xHH / \uHHHH in the typed data become
// the characters they name, so a code can carry a tab between fields or a GS
// separator (\x1D). An unrecognised escape is kept as typed.

const SIMPLE: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', '\\': '\\' };

export function decodeBarcodeEscapes(data: string): string {
  return data.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (whole, code: string) => {
    if (code.length > 1) return String.fromCharCode(parseInt(code.slice(1), 16));
    return SIMPLE[code] ?? whole;
  });
}

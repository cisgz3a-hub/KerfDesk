declare module '*.css';
declare module '../../../scripts/scanner-decoder-entry.js' {
  export default function decodeQr(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): { data: string } | null;
}

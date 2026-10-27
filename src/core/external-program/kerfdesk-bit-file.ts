// The bit a KerfDesk per-bit file names in its header (rolling audit v4
// H3-P2-2, ADR-392 Amendment 4). A setup package's one-file-per-bit export
// starts each file with `; bit N of M: <bit>` (cnc-tool-programs.ts,
// ADR-392 Amendment 3), and a tile that needs several bits starts each of its
// files with `; bit N of M for this tile: <bit>` (tile-bit-files.ts, Amendment
// 2). Run G-code file treats the gap between two such files as Start treats an
// M0 bit change. Read from the file as opened: the bytes an external run sends
// carry no comments.

export type KerfDeskBitFile = {
  /** This file's place in its set, from 1. */
  readonly order: number;
  /** How many bit files the set holds; always 2 or more. */
  readonly count: number;
  readonly bitName: string;
};

const BIT_HEADER = /^; bit (\d+) of (\d+)(?: for this tile)?: (.+)$/;
// The header leads the file; stop at the first line that is not a comment.
const HEADER_LINES_READ = 4;

/** The bit file this text is, or null when it is not one of a set of two or more. */
export function kerfDeskBitFile(text: string): KerfDeskBitFile | null {
  for (const raw of text.split('\n', HEADER_LINES_READ)) {
    const line = raw.trim();
    if (!line.startsWith(';')) return null;
    const match = BIT_HEADER.exec(line);
    if (match === null) continue;
    const order = Number(match[1]);
    const count = Number(match[2]);
    const bitName = match[3]?.trim() ?? '';
    if (count < 2 || order < 1 || order > count || bitName.length === 0) return null;
    return { order, count, bitName };
  }
  return null;
}

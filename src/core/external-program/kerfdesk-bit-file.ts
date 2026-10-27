// The bit a KerfDesk per-bit file names in its header (rolling audit v4
// H3-P2-2, ADR-392 Amendment 4). A setup package's one-file-per-bit export
// opens each file with `; bit N of M: <bit>` (cnc-tool-programs.ts, ADR-392
// Amendment 3). A tile that needs several bits writes `; bit N of M for this
// tile: <bit>` into each of its files (tile-bit-files.ts, Amendment 2) below
// the metadata header and the `; tile:` line (tile-emission.ts): up to twelve
// comment lines come first. Run G-code file treats the gap between two such
// files as Start treats an M0 bit change. Read from the file as opened: the
// bytes an external run sends carry no comments.

export type KerfDeskBitFile = {
  /** This file's place in its set, from 1. */
  readonly order: number;
  /** How many bit files the set holds; always 2 or more. */
  readonly count: number;
  readonly bitName: string;
};

const BIT_HEADER = /^; bit (\d+) of (\d+)(?: for this tile)?: (.+)$/;
// The header is somewhere in the file's leading comment block, which ends at
// the first line that is not a comment. A tile's bit line falls at line 13 at
// the latest, so a four-line read missed every one (rolling audit v5 J1-P2-1,
// ADR-392 Amendment 5); the cap only bounds a file that is all comments.
const HEADER_LINES_READ = 64;

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

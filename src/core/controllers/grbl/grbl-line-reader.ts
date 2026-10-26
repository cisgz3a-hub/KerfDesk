// grbl-line-reader — the line stock GRBL's parser receives for a typed line.
//
// GRBL's line reader filters every byte before it decides what the line is: it
// drops whitespace, control characters and the block-delete '/', removes
// `( … )` comments (to the next ')' or the end of the line), cuts a `;`
// comment and upper-cases letters. Only then does a line that starts with '$'
// go to the system-command parser. So `(x)$30=255` and `$30(x)=255` reach it
// as `$30=255` (meta audit v1 M6-P2-1, ADR-375 Amendment 6).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L78-L149

/** The text GRBL's parser would receive for `line`, as stock GRBL filters it. */
export function grblLineReaderView(line: string): string {
  let kept = '';
  let inComment = false;
  for (const char of line) {
    if (inComment) {
      inComment = char !== ')';
      continue;
    }
    if (char === ';') break;
    if (char === '(') inComment = true;
    else if (char > ' ' && char !== '/') kept += char.toUpperCase();
  }
  return kept;
}

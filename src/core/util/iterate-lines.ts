// Allocation-free line iteration over a large text buffer.
//
// `text.split(/\r\n|\n|\r/)` materializes every line at once: on a 100 MB
// G-code program that is 3.3 M strings and a measured 570 MB heap spike, paid
// before the first line is even looked at. Both large-text parsers (G-code
// programs and DXF tag pairs) only ever walk forward, so they can pull one line
// at a time and let each be collected.
//
// The line break set is exactly the one `split(/\r\n|\n|\r/)` uses — CRLF, LF,
// and a bare CR — and the sequence produced is identical to that split's,
// including the trailing empty string a file ending in a newline yields. That
// equivalence is property-tested, because it is what lets the parsers swap
// without any behavior change.

const CR = '\r';
const LF = '\n';

export function* iterateLines(text: string): Generator<string, void, undefined> {
  let lineStart = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === LF) {
      yield text.slice(lineStart, index);
      index += 1;
      lineStart = index;
      continue;
    }
    if (char === CR) {
      yield text.slice(lineStart, index);
      // CRLF is ONE break, not two — otherwise every line would be followed by
      // a spurious empty one.
      index += text[index + 1] === LF ? 2 : 1;
      lineStart = index;
      continue;
    }
    index += 1;
  }
  // split() always emits a final element, including the empty string after a
  // trailing newline and the single empty string for an empty input.
  yield text.slice(lineStart);
}

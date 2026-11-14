## ADR-490 Amendment 5 - A whole camera picture may carry bytes after its end marker (2026-11-15)

**Status:** Accepted. Fixes camera audit v2 K6-P3-3 (P3). Amends Amendment 3's cut-picture check
(K4-P3-2), which looked for the end marker in a picture's last 16 bytes only. Code and synthetic
evidence only. | **Date:** 2026-11-15

### Context

Amendment 3 refuses a JPEG cut short by a camera that closed its connection mid-picture. It looked for
the end-of-image marker (FF D9) only in the last 16 bytes. Some cameras pad their picture buffers or
append data after the marker. With 15 or more such bytes, every picture would read "The camera sent a
picture cut short", and the camera would never connect.

### Decision

1. **A picture is whole when an end marker follows the start of its picture data.** That start is the
   main image's first start-of-scan, found by walking its segments, so a thumbnail's own end marker
   in an earlier block does not count. Inside picture data an FF byte is always followed by 00 or a
   restart marker, so an FF D9 found there is the real end. Any bytes after it are allowed.
2. A picture whose segments cannot be walked to its picture data keeps Amendment 3's rule.

### Consequences

- Padded or appended pictures are taken; a picture cut in its data, or in a block before it, is still
  refused.

### Verification

`electron/camera-frame-jpeg-end.test.ts`:
- a whole picture is taken with 0 to 4,096 bytes after its end;
- one cut in its data, or inside a block holding a thumbnail, is refused.

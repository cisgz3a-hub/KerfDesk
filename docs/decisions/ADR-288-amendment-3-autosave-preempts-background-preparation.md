## ADR-288 Amendment 3 - Recovery no longer waits for an active preparation (2026-11-03)

**Status:** Accepted on 2026-11-03 |
**Amends:** ADR-288 Amendment 1 ("Recovery keeps its normal interval but waits for an active
preparation, and later preparation requests wait their turn"), with ADR-598 Amendment 3

### Context

Performance audit S1, area S3, confirmed S3-P2-2: behind the background preparation of four
bed-sized photos, the first autosave after an edit landed about 125 s later instead of within its
30 s interval, and a crash in that window lost the edit.

### Decision

Recovery keeps its normal interval and no longer waits for an active preparation. Its worker
reserves the memory lane as interactive work, so a running preparation retires its worker and
restarts after the short autosave worker (ADR-598 Amendment 3 has the details and the cost). The
lane still holds one worker heap at a time, so the reason for Amendment 1's lane, not overlapping
large heaps in Chromium's shared pointer-compression cage, is kept. Later preparation requests
still wait their turn.

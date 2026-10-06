## ADR-204 Amendment 1 — Prepare large manual saves before a fresh file choice

**Status:** Accepted | **Date:** 2026-10-05

### Context

The computer-use audit saved a 225,660,453-byte project with 51,000 contours. The unchanged
manual validation algorithm took 11.0 seconds in a Node reproduction over that artifact.
Running it synchronously before the native picker occupies the canvas thread and can outlast
the browser's transient file-picker activation. ADR-204 still requires validation and semantic
drift refusal before any canonical file selection or write.

### Decision

- Small manual saves retain synchronous validation and their direct native picker.
- Large captured projects use the same `prepareProjectForPersistence` algorithm in a short-lived
  worker, through the shared worker-memory lane and packed geometry transfer (ADR-346).
  The worker returns only validated JSON; it does not clone the normalized scene back.
- First Save and Save As show preparation, then **Choose file…** invokes the native picker
  directly inside a fresh click. A refused or failed preparation never selects a canonical file.
- Save to a retained target prepares in the worker and writes without another picker.
- Cancel or a newer document/request stops unselected preparation and removes its ready prompt.
  Queued reservations and active workers release their memory ownership. Worker startup, message
  or transfer failure reports an error; it never falls back to large synchronous preparation.
- A retained target or an already opened picker retains its captured request ownership. Selected
  writes still reach the destination, and the existing coordinator reconciles overlapping writes.
  Only the newest request for the current document may publish clean state/name/target; newer edits
  remain dirty and preserve recovery, and pending New/Open/Close still stop on that outcome.
- Semantic validation and drift refusal remain unchanged. After the existing explicit recovery
  confirmation, a large refused project prepares the same raw serializer bytes in the worker,
  then **Choose recovery file…** selects a separate target with a fresh click. It remains raw,
  may need repair to reopen, and never marks the canonical project saved or clears recovery.
- Scheduling tolerates malformed runtime metadata; it cannot replace canonical validation or
  remove the recovery offer. Only exact typed geometry shapes may be packed: coordinates stay
  finite doubles, closed/arc flags stay booleans, and every point/polyline/curve/segment has the
  exact retained keys. Other live geometry reaches the worker unchanged so packing cannot hide
  drift by coercing values or dropping unknown fields. Raw recovery always sends the original
  project graph, preserving the raw serializer's values and fields.

### Verification

The pure preparation reproduction retained the exact 225,660,453-byte output and SHA-256.
Worker/session regressions cover fresh-click invocation, cancellation, worker failure and release,
normalization refusal, captured bytes versus newer edits, stale unselected owners and retained
target writes after a replacement document. Native browser validation is recorded separately
from the Node reproduction; neither qualifies hardware or the packaged desktop.

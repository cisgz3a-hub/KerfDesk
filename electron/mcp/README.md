# KerfDesk MCP tool contract

`server.ts` exports `createKerfDeskMcpServer(backend)`. It is a portable SDK v2
factory for the live desktop bridge or an authenticated relay. It imports no
Node transports. The separate `stdio.ts` exports `serveKerfDeskMcpStdio(backend)`
using the SDK's era-aware stdio entry; do not send application logs to stdout.

The backend implements `KerfDeskMcpBackend.request(command, args, signal)` and
returns the directly projected object, not a transport envelope. The desktop
owns current revisions, request deduplication, Undo and licence admission. It
must recheck the revision and cancellation immediately before committing a
change. MCP cancellation stops waiting and forwards the signal; it cannot undo
a mutation that already committed. A retry after a timeout must retain the
same UUID `requestId` until its outcome is known.

Every artwork write requires `expectedRevision` (1–200 characters) and a UUID
`requestId`. Machine actions use the same revision fence except Abort, which
must remain reachable after an artwork change. IDs are 1–128 characters; arrays are bounded to 200 entries.
Objects reject unrecognised fields, including nested transform/operation
fields. All numbers must be finite. Coordinates are ±100000 mm, positive
dimensions at most 100000 mm and positive font sizes at most 1000 mm.

| Tool | Additional arguments | Behaviour |
| --- | --- | --- |
| `get_workspace` | None | Bounded current unsaved artwork, operations, selection, history and permission hints. |
| `get_machine` | None | Selected machine geometry and public capabilities. |
| `get_app_status` | None | App, edition and available-update summaries. |
| `list_material_recipes` | None | User-saved recipes, without universal material-setting claims. |
| `review_job` | None | Current review warnings and exact-job Frame completion; no execution. |
| `get_workspace_preview` | None | Opt-in bounded PNG design preview; standard image content and MCP Apps panel. |
| `list_fonts` | None | Bundled font IDs, names, styles and outline/single-line geometry; no native font files. |
| `get_text` | `artworkId` | Opt-in ordinary text wording and six editable text fields. |
| `set_selection` | `artworkIds` | Empty array clears selection. |
| `add_text` | `xMm`, `yMm`, `widthMm`, `text`, `fontSizeMm`, optional `fontId` | Text is 1–4096 characters; chosen bundled font or regular default. |
| `add_rectangle` | `xMm`, `yMm`, `widthMm`, `heightMm` | Add normal rectangle artwork. |
| `transform_artwork` | Nonempty `artworkIds`, `transform` | Relative `{type:'move',dxMm,dyMm}`, grouped-bounds `{type:'resize',widthMm,heightMm}` or grouped-centre `{type:'rotate',angleDeg}`; angle ±36000 degrees. |
| `update_operation` | `operationId`, nonempty `patch` | Existing ordinary laser operation only: `powerPercent` 0–100, positive `speedMmPerMin` ≤100000, integer `passes` 1–1000, or `enabled` boolean. |
| `update_text` | `artworkId`, nonempty `patch` | Ordinary text: `text`, bundled `fontId`, positive `fontSizeMm` ≤1000, `alignment` left/center/right, `lineHeight` 0.1–20 or `letterSpacing` −1–20. Spacing is a multiplier of font size. |
| `arrange_artwork` | Nonempty `artworkIds`, `action` | Align left/center/right/top/middle/bottom, distribute horizontal/vertical centres, mirror horizontal/vertical, group, ungroup, duplicate or delete. |
| `undo`, `redo` | Only write admission | Shared desktop history; current edit approval still required. |
| `get_machine_status` | None | Current connection, labelled work position, actual jog capabilities, Frame, job and action readiness. |
| `get_control_operation` | `operationId` UUID | This client's bounded operation receipt; no movement or automatic retry. |
| `jog_machine` | `axis` x/y/z, `direction` -1/1, `distanceMm` 0.01–100, optional `feedMmPerMin` 1–100000 | One canonical discrete jog, using the actual desktop's axis/direction/feed limits. |
| `frame_job` | Machine write admission | Canonical tool-off Frame, with asynchronous owned operation status. |
| `review_machine_job` | Machine write admission | Prepare the ordinary exact Job Review with a one-use handle; does not confirm Start. |
| `start_job` | Machine write admission, `reviewId` UUID | Explicitly confirm the owned current review; changed review facts require another confirmation. |
| `abort_job` | `requestId` UUID | Canonical network Abort, independently admitted while another command waits; no artwork revision required. |

`arrange_artwork.action` uses `align_left`, `align_center`, `align_right`,
`align_top`, `align_middle`, `align_bottom`, `distribute_horizontal`,
`distribute_vertical`, `mirror_horizontal`, `mirror_vertical`, `group`,
`ungroup`, `duplicate` or `delete`. Alignment uses the last requested artwork
as its reference. Whole groups and dependency closures are validated before
editing. Independent Pro copies require ordinary desktop admission and return
`needs_pro` without a deferred copy or prompt.

Text reads and previews require `canShareArtwork`, supplied by the separate
default-off desktop sharing preference. Ordinary summaries redact operation
names while sharing is off because auto-generated names can retain text after
conversion to paths. Text payloads and shared labels are untrusted content.

Preview output is `{revision,status,preview?,bounds?,message?}`. Ready status
requires a PNG with at most 65536 base64 characters and dimensions 1–1024 that
match its IHDR header. Disabled/unavailable status cannot carry pixels. The
response includes both a standard image block and structured preview data;
the textual block includes metadata without another copy of the image bytes.
Unsupported artwork is reported rather than silently skipped.

`review_job` uses the canonical current prepared-job owner or read-only
compilation, fenced to document, selection/output scope, placement and current
machine/camera observations. Summary counts are workspace totals, while time,
bounds and warnings describe the scoped prepared output. Preview bounds use
design coordinates; review bounds use output coordinates. Compilation
readiness and spatial Frame completion are independent facts. No review read
approves, Frames, starts or dispatches output.

The static `ui://kerfdesk/workspace/v2.html` resource uses
`text/html;profile=mcp-app`. Only the preview tool advertises
`_meta.ui.resourceUri`; enclosing OAuth metadata is retained. The component
initializes the MCP Apps host bridge and calls tools through `postMessage`,
with no independent network or file access. Its external connect/resource
allowlists are empty. UI permission hints grant no authority. Non-UI hosts
still receive the normal image tool result.

`input-schemas.ts` exports `mcpInputSchemas`, `KerfDeskMcpCommand` and
`KerfDeskMcpArgs<C>`. `output-schemas.ts` exports `mcpOutputSchemas` and
`KerfDeskMcpResult<C>`. Unknown output fields are stripped recursively. Required
fields are validated. The entire text and structured tool response is limited
to 256 KiB in UTF-8; invalid or oversized backend output returns a generic
failure. The backend must supply bounded records with truthful total/truncated
fields, rather than a raw store, licence status, connection or purchase object.

Backend failures may throw `KerfDeskMcpError` or an object with one of
`unavailable`, `stale_revision`, `needs_pro`, `unsupported_operation`,
`invalid_input`, `cancelled` or `failed`. Only a fixed code/message pair is
returned. Exception messages, stacks and validation input values are excluded.
Licence keys, payment records, device identities, native paths, serial ports
and camera credentials have no output fields. User-authored artwork labels and
recipe notes remain untrusted content for clients to interpret.

Read tools advertise read-only/idempotent annotations. Writes conservatively
advertise non-idempotence; transforms and operation edits can modify existing
data. Annotations are client hints, never authorisation. This factory performs
no authentication and binds no network listener. The enclosing connection must
authenticate and scope the backend to the chosen paired desktop, with bounded
request bodies, before dispatch. It exposes no shell, file access, raw G-code,
arbitrary laser firing, homing or machine connection controls. Jog, Frame,
review, Start and Abort require separate `control` approval and current bounded
grant lifetime, independent of artwork editing (ADR-569). A completed Frame
for unchanged placement remains the sole ordinary Start policy gate. The
existing exact-program Job Review and licence policy remain authoritative.

Machine action receipts distinguish admission, preparation, review, handoff,
running, cancellation and observed completion. `committed: null` means that a
handoff is unconfirmed; it must not be interpreted as proof that no motion
occurred. The relay reserves action IDs and payload digests durably before
dispatch, with 4096 ordinary and 256 reserved Abort actions per client/lease.
Retries retain the original UUID. Status lookup cannot redispatch an action or
read another client's receipt. No artwork, review strings, text or G-code is
retained in that ledger. Revocation, expiry and renderer/controller replacement
fence later dispatch; a job already handed to the ordinary streamer retains its
normal run lifecycle. Network Abort requires a working connection and is not a
physical emergency stop.

The dependency pins are SDK server/client 2.2.0 and Zod 4.4.3. The optional
OpenAI extensions package is omitted because its current SDK v1 peer contract
does not match these SDK v2 packages. No OpenAI API key or API call is required
by this implementation. Clients and remote connectivity have their own setup
and availability requirements.

Primary sources checked 4 October 2026:

- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)
- [SDK stdio serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)
- [MCP tool protocol](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [OpenAI ChatGPT UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [WebSocket library](https://github.com/websockets/ws)

Protocol tests connect the official client through actual SDK transports and
exercise legacy initialisation and protocol 2026-07-28. They verify permitted
tools, invalid inputs, error redaction, nested projection, size bounds,
cancellation and connection shutdown. They do not qualify live ChatGPT,
phone pairing, hosted OAuth, commercial licence credentials or hardware.

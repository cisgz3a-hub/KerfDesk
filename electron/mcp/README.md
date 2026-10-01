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

Every write requires `expectedRevision` (1–200 characters) and a UUID
`requestId`. IDs are 1–128 characters; arrays are bounded to 200 entries.
Objects reject unrecognised fields, including nested transform/operation
fields. All numbers must be finite. Coordinates are ±100000 mm, positive
dimensions at most 100000 mm and positive font sizes at most 1000 mm.

| Tool | Additional arguments | Behaviour |
| --- | --- | --- |
| `get_workspace` | None | Bounded current unsaved artwork, operations and selection. |
| `get_machine` | None | Selected machine geometry and public capabilities. |
| `get_app_status` | None | App, edition and available-update summaries. |
| `list_material_recipes` | None | User-saved recipes, without universal material-setting claims. |
| `review_job` | None | Current review warnings and exact-job Frame completion; no execution. |
| `set_selection` | `artworkIds` | Empty array clears selection. |
| `add_text` | `xMm`, `yMm`, `widthMm`, `text`, `fontSizeMm` | Text is 1–4096 characters; use the existing selected font or regular default. |
| `add_rectangle` | `xMm`, `yMm`, `widthMm`, `heightMm` | Add normal rectangle artwork. |
| `transform_artwork` | Nonempty `artworkIds`, `transform` | Relative `{type:'move',dxMm,dyMm}`, grouped-bounds `{type:'resize',widthMm,heightMm}` or grouped-centre `{type:'rotate',angleDeg}`; angle ±36000 degrees. |
| `update_operation` | `operationId`, nonempty `patch` | Existing ordinary laser operation only: `powerPercent` 0–100, positive `speedMmPerMin` ≤100000, integer `passes` 1–1000, or `enabled` boolean. |

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
Frame, Start, machine connection or motion tools. Normal desktop operator
controls and policy remain responsible for machine work.

The dependency pins are SDK server/client 2.2.0 and Zod 4.4.3. The optional
OpenAI extensions package is omitted because its current SDK v1 peer contract
does not match these SDK v2 packages. No OpenAI API key or API call is required
by this implementation. Clients and remote connectivity have their own setup
and availability requirements.

Primary sources checked 1 October 2026:

- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [SDK tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html)
- [SDK stdio serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)
- [MCP tool protocol](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [WebSocket library](https://github.com/websockets/ws)

Protocol tests connect the official client through actual SDK transports and
exercise legacy initialisation and protocol 2026-07-28. They verify permitted
tools, invalid inputs, error redaction, nested projection, size bounds,
cancellation and connection shutdown. They do not qualify live ChatGPT,
phone pairing, hosted OAuth, commercial licence credentials or hardware.

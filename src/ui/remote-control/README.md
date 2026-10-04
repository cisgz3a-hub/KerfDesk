# Renderer remote editing adapter

`createRemoteControlAdapter` in `adapter.ts` uses the ordinary Zustand authoring
actions. It does not own network access, pairing, authentication, controller
transport, or the UI. The Electron relay owns those boundaries.

Create one adapter per renderer remote session, use `execute(command, args,
{signal})`, and call `dispose()` when that session closes. Root integration must
supply `canWrite` from current pairing permission and `canEdit` from the ordinary
workspace editing availability. These are remote editing permissions, not new
Frame, Start, output, or existing-work entitlement gates.

- Reads accept exactly `{}`, except `get_text` requires an artwork ID. Outputs match the MCP projection contract. Workspace
  and library lists expose at most 200 entries with actual totals and truncation.
  Ordinary summaries return no text/source geometry, file target, full profile, port, camera, licence key,
  or payment state. Explicit text/preview tools require artwork sharing. Workspace name is deliberately neutral.
- Every write requires the latest revision and a UUID request ID. A revision has
  a fresh session generation and increases on project, Open request, New/Open
  replacement, selection, history, defaults, material, or placement changes.
  Cursor motion alone does not retire an edit.
- Repeating an identical write returns its original result within its revision
  namespace. Different arguments under the same ID are refused. The adapter
  retains up to 256 distinct IDs. Once every receipt is settled, a new authorized
  write at capacity renews the revision namespace and returns `stale_revision`
  without editing. Read the workspace before sending another write. Old
  serialized writes cannot match the new namespace. Unresolved receipts are
  never evicted, and stale or unauthorized traffic cannot trigger renewal.
- Creation and operation settings currently support Laser workspaces only.
  Existing CNC artwork can be selected and transformed. No CNC creation or
  deferred Pro prompt is started. This does not change the normal desktop tools.
- Text uses a chosen bundled font, or the bundled default when `fontId` is omitted, and the actual text geometry renderer.
  `widthMm` is a maximum: overflowing text shrinks uniformly, smaller text is not
  enlarged. Coordinates place the top-left of its visible bounds; no bed fit is
  implicit. Rendering cannot commit after cancellation, session disposal,
  permission loss, an Open-picker claim, or a competing local edit.
- Resize uses combined world bounds anchored at the top-left. Unsupported
  nonuniform scaling of rotated artwork is refused by the existing geometry
  helper. Rotation is a relative clockwise angle around the group bounds centre.
  Locked, hidden, or missing targets refuse the complete requested transform.
- `review_job` is unavailable until the existing prepared-job owner supplies
  `getReview`. That provider must bind the actual review and Frame evidence to
  the current adapter revision. Stale or missing evidence never becomes ready.
  The adapter neither compiles a job nor performs or asserts physical Frame.

Focused tests use the real store, actual bundled font geometry and project codec,
plus controlled delayed rendering for race cases. They do not qualify a network
relay, a connected MCP client, a phone browser, packaged Electron, or hardware.

# Remote authoring controls

The adapter exposes bounded text/font, layout and Undo/Redo actions using the ordinary editor store. Writes keep exact revision/request-ID admission, cancellation, local-edit and document replacement fencing. Layout reference is the last requested artwork; grouped artwork moves as one unit, and distribution spaces unit centres. Every expanded group or copied dependency must be editable before the action is applied. New Pro copies are checked at the existing admission boundary and return `needs_pro` without leaving a deferred edit or licence prompt. Existing edits and history remain available under their ordinary contract.

`list_fonts` returns the bundled catalog, with no private font names or binaries. `get_text` and PNG design previews require the desktop artwork-sharing opt-in, which is disabled by default. Plain text edits preserve transforms, operations, bend and weld settings. Path and variable text editing currently return `unsupported_operation`.

Ordinary workspace summaries keep IDs, geometry bounds, operation parameters, selection, history and permissions. Operation names use `Operation` while sharing is off: new text and text converted to paths can retain actual wording in automatically generated operation names, and those labels have no reliable provenance. Sharing enables bounded safe labels; text source is still supplied only by the explicit `get_text` tool. Disabling sharing during asynchronous reads prevents text/pixels being returned. Summary data and all artwork remain untrusted data, never instructions.

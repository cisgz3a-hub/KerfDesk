# Renderer remote editing adapter

`createRemoteControlAdapter` in `adapter.ts` uses the ordinary Zustand authoring
actions. It does not own network access, pairing, authentication, controller
transport, or the UI. The Electron relay owns those boundaries.

Create one adapter per renderer remote session, use `execute(command, args,
{signal})`, and call `dispose()` when that session closes. Root integration must
supply `canWrite` from current pairing permission and `canEdit` from the ordinary
workspace editing availability. These are remote editing permissions, not new
Frame, Start, output, or existing-work entitlement gates.

- Reads accept exactly `{}`. Outputs match the MCP projection contract. Workspace
  and library lists expose at most 200 entries with actual totals and truncation.
  No text/source geometry, file target, full profile, port, camera, licence key,
  or payment state is returned. Workspace name is deliberately neutral.
- Every write requires the latest revision and a UUID request ID. A revision has
  a fresh session generation and increases on project, Open request, New/Open
  replacement, selection, history, defaults, material, or placement changes.
  Cursor motion alone does not retire an edit.
- Repeating an identical write returns its original result. Different arguments
  under the same ID are refused. The session retains 256 distinct IDs without
  eviction, then fails closed with a bounded-session explanation. Reconnect for
  a fresh session and read its new revision. Do not silently rebuild the adapter
  for every command.
- Creation and operation settings currently support Laser workspaces only.
  Existing CNC artwork can be selected and transformed. No CNC creation or
  deferred Pro prompt is started. This does not change the normal desktop tools.
- Text uses the bundled default font and the actual text geometry renderer.
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

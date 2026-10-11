## ADR-582 - Connect full desktop editors through an explicit local studio preview

Date: 2026-10-11
Status: Accepted for local desktop preview; distribution qualification pending

### Context

The maintainer requested a replacement Design Studio using the full PhotoCraft
and VectorCraft editors, developed in a separate worktree while retaining the old
studio until the replacement works. KerfDesk is an Electron/React application;
the upstream editors are native Rust applications. Their existing control APIs
provide a concrete first integration without rewriting their editing engines.

### Decision

1. Connect the unmodified Windows x64 PhotoCraft 0.7.0 and VectorCraft 0.9.0
   applications as companion windows. The Design Studio's **Desktop editors**
   button opens a preview panel. This is the first desktop integration, not an
   embedded or unified replacement. The existing studio remains available.
2. Install the pinned upstream portable releases locally with
   `node scripts/prepare-artcraft-studio.mjs`. Pin archive and executable SHA-256
   values in code; a manifest cannot authorise a replacement executable by
   declaring its own digest. Verify the executable again before launching it.
   Do not bundle these downloads in the normal KerfDesk package.
3. Keep process launch, filesystem access and TCP control in Electron's main
   process. The renderer uses the guarded `app://app/api/artcraft-studio` route.
   Require the desktop origin/header checks; do not accept arbitrary executable
   locations or filesystem paths from renderer requests.
4. Give each editor session its own working directory, settings and automation
   read/write roots. PhotoCraft uses bearer-token authentication. VectorCraft's
   pinned version has no control authentication: use an ephemeral loopback port
   and confined roots, and treat exposure to other local processes as an explicit
   preview limitation. This is not a production security boundary.
5. Create blank documents at explicit physical dimensions, or open SVG in
   VectorCraft and PNG/JPEG in PhotoCraft. Vector dimensions use unit-bearing
   strings because upstream numeric dimensions are points. Photo dimensions use
   pixels and DPI. Both editors remain complete applications in separate windows;
   this preview does not combine their documents or undo histories.
6. **Apply to KerfDesk** saves the managed working document, preserves a native
   revision and imports a handoff through KerfDesk's existing import pipeline.
   PhotoCraft hands off PNG; VectorCraft hands off one SVG artboard, with text
   outlined and images embedded. Vector export warnings are surfaced rather than
   silently declaring a faithful handoff. Other tabs or Save As paths are not
   implicitly bound to the managed session.
7. Disable VectorCraft background saves/exports for this connection. Compare
   active document, controlled path, revision and dimensions around the handoff;
   reject detected changes during Apply. Serialize operations within a session.
   These checks do not create a shared transactional document model across apps.
8. Keep native `.pcraft`/`.vectorcraft` working files and saved revisions in
   KerfDesk's userData `artcraft-studio` directory. Reopening preserves the saved working file, copying the last applied revision only when it is missing. Ordinary editor Save does not overwrite an earlier captured revision.
   `.lf2` projects contain the imported artwork, not a portable copy of the full
   upstream native session. The panel and documentation disclose this boundary.
9. Keep machining operations, machine configuration and Frame/Start behavior in
   KerfDesk. No new entitlement, machine policy or automatic output behavior is
   introduced. No controller is operated by this integration.

### Verification and release boundary

Focused tests exercise protocol authentication/framing, refusal and timeout
behavior, origin and input checks, confined filesystem paths, native-save order,
physical dimensions, managed document identity and the one-artboard boundary.
Native smoke evidence must be reported separately from these tests and from
browser/desktop renderer evidence. No test substitutes for hardware qualification.

Upstream core source has an MIT licence option. That does not establish that every
bundled asset, font, dependency, icon, name or installer may be redistributed under
KerfDesk branding. A component/asset/notice review and distribution plan remain
required before a public bundled release. KerfDesk's own licence is unchanged.

Further work is needed for a unified studio shell, direct photo-layer round trips,
portable native project storage, broader fidelity testing and a qualified
redistribution package. The old studio is not retired by this decision.

### Primary source references

- [PhotoCraft 0.7.0 control protocol](https://github.com/storytold/photocraft/blob/v0.7.0/docs/control-protocol.md)
- [VectorCraft 0.9.0 control protocol](https://github.com/storytold/vectorcraft/blob/v0.9.0/docs/control-protocol.md)
- [PhotoCraft document inspection](https://github.com/storytold/photocraft/blob/v0.7.0/crates/engine/src/inspect.rs)
- [VectorCraft document inspection](https://github.com/storytold/vectorcraft/blob/v0.9.0/crates/engine/src/inspect.rs)
- [VectorCraft SVG export options](https://github.com/storytold/vectorcraft/blob/v0.9.0/crates/engine/src/cmd/fileio/svg.rs)
- [PhotoCraft MIT licence](https://github.com/storytold/photocraft/blob/v0.7.0/LICENSE-MIT)
- [VectorCraft MIT licence](https://github.com/storytold/vectorcraft/blob/v0.9.0/LICENSE-MIT)



## ADR-589 - Host full native editors in one project-owned desktop studio

Date: 2026-10-11
Status: Accepted for local Windows desktop preview
Amends: ADR-588 companion-window and nonportable project boundaries

### Decision

The preview hosts the complete, unmodified PhotoCraft 0.7.0 and VectorCraft 0.9.0
windows inside KerfDesk's reserved editor viewport. Project document buttons
switch between native editors. The existing Design Studio remains available.

Electron main owns native handles and launched-process identities. A local
PowerShell/C# helper validates parent PID and child PID, executable and creation
time, adjusts window styles and uses SetParent. CSS viewport coordinates map to
the actual parent client rectangle for DPI scaling. Only known runtime sessions
can attach; renderer requests cannot supply HWNDs, executable paths or process IDs.
Dialogs and project operations hide native surfaces while HTML controls need them.
The existing close guard detaches editors after approval, before destroying the
parent. It does not terminate native editors. Abrupt parent crashes cannot
guarantee child-window preservation. The native apps retain their own custom
titlebar controls and native Ctrl+S behavior.

Project schema 16 adds optional studioDocuments containing native bytes, editor
identity/version, a durable document UUID, SHA-256 and revision. Validate canonical
base64, metadata, duplicates and budgets (32 MiB per document; 64 MiB total including
archives; 64 documents per document collection). Main verifies actual SHA-256 and
the pinned editor version before restoring source into a new controlled session.
Older projects migrate without inventing documents; older readers must not
silently strip these new documents.

Transient process/session IDs are separate from the project document UUID.
Apply uses the durable UUID in its imported artwork filename, so reopening in a
new profile and applying again updates the existing artwork. Apply captures the
native file and PNG/SVG from the same checked editor revision. The renderer queues
that handoff and its project commit with background capture. KerfDesk still owns
machining operations and the existing import review.

Save checkpoints live managed native documents before project serialization.
New/Open/Close checkpoint before evaluating unsaved changes. Close starts its
existing stop handshake immediately; capturing files never delays that handshake.
A five-second recovery capture feeds the normal project/autosave machinery.
Unchanged editor revisions reuse captured native bytes instead of rewriting files.
All asynchronous commits check project ownership; Undo/replacement of embedded
source requires reopening the project version. The registry survives closing the
studio panel and is cleared when the project document changes.

### Verification and limitations

Native smoke exercises both full applications, actual embedded rendering,
keyboard routing, resize/switch/hide, detachment and hidden control requests.
Portable-source smoke restores both editors in fresh profiles. The integrated
renderer smoke creates both documents, invokes project Save, opens the resulting
.lf2 in a fresh application profile, restores both editors and reapplies vector
artwork without duplication. Deterministic file-picker handles are test doubles;
project serialization, native files and native editor processes are real.

This is a local development preview, not a public installer. No machine was
operated. Native multi-tab documents opened independently inside upstream apps
are not implicitly bound; use project document controls. The full native document
is embedded, but external linked resources, installed fonts and broad feature
fidelity still need qualification. Apply currently supports one vector artboard
and flattened photo output. Native layer editing remains inside its respective
editor, with separate undo histories. ADR-588's local control-protocol and
redistribution/licence limitations still apply.

### Primary references

- [Microsoft SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [Electron BrowserWindow native handle](https://www.electronjs.org/docs/latest/api/browser-window)
- [ADR-588](ADR-588-desktop-artcraft-studio-preview.md)

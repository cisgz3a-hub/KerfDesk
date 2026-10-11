# Desktop studio preview

> Current direction (ADR-590): improve KerfDesk's own Design Studio. The hosted
> editor replacement was rejected after the quality review. Open Design Studio
> directly for labelled tools, docked properties, shape selection and alignment.
> The launcher below now opens that preview without requiring native editor
> installation. Existing embedded sources remain under Legacy editor documents
> in projects that already contain them. The rest of this document describes the
> earlier native-editor experiment and its limitations.

The current preview has **Vectors** and **Photos** workspaces inside Design Studio.
Photos opens existing project images or imports PNG/JPEG/BMP/GIF. Common preparation
tools, layers and history are visible; vector selections have quarter-turn and
mirror actions. Apply each workspace's edits, then save the project from the main
workspace. Finished raster pixels, editable photo layers, exact Studio sketches and vector artwork
are saved together. Opening the project in a fresh app profile restores its sources.
Apply your changes, then save the project; unapplied drafts remain session work. TIFF imports use
the main workspace's page dialog before opening the result in Studio Photos.

Crop, image/canvas resize and layer changes now support Undo/Redo, including
add/delete/duplicate/merge/reorder and layer properties. The shared 2D canvas
shows photos with vector artwork and opens a selected photo in its embedded editor. The full-editor setup below is historical and unnecessary
for the current preview.

This local Windows preview connects the **full PhotoCraft 0.7.0 and VectorCraft
0.9.0 desktop applications** to KerfDesk. Each editor opens in its own window.
The current Design Studio is retained. The preview is the first working connection
towards a replacement, not yet a unified editing surface.

## Set up and open

From the isolated worktree, with the project's Node/pnpm dependencies available:

```powershell
node scripts/prepare-artcraft-studio.mjs
node scripts/start-artcraft-studio.mjs
```

Setup downloads the pinned Windows x64 portable releases into `.artcraft`, checks
the archive and executable digests, and writes the installation manifest. Launch
builds the preview and uses `.artcraft/kerfdesk-preview` as its isolated KerfDesk
userData directory. The ordinary installed KerfDesk profile is not the preview's
storage location.

In Design Studio, choose **Desktop editors**. Select VectorCraft or PhotoCraft,
set the document dimensions, and open the editor. You can also open an SVG in
VectorCraft or a PNG/JPEG in PhotoCraft through the panel.

Edit in the native window, then return to the panel and select **Apply to
KerfDesk**. This is an explicit transfer; changes do not stream into a machining
job while you draw. Keep the managed working document selected during Apply.
Another tab or a file saved under a different path is not automatically linked.

## What is preserved

- PhotoCraft saves an editable `.pcraft` native revision and transfers a PNG for
  KerfDesk's image workflow. Physical size comes from the document's pixels and
  DPI. Photo layers remain editable in PhotoCraft.
- VectorCraft saves an editable `.vectorcraft` native revision and transfers SVG.
  The current handoff requires exactly one artboard. It outlines text, embeds
  images and keeps explicit dimensions. Native text and effects remain editable
  in the saved VectorCraft document.
- Apply uses the existing KerfDesk import and reimport pipeline. Applying the
  same session again targets its earlier imported artwork. Multiple separate
  copies of that session require resolving the target before applying again.
- The old studio and KerfDesk's machining workflow remain available. Frame,
  Start and controller behavior are unchanged.

## Where your work lives

Session metadata, working files, editor settings and native revision copies live
under `artcraft-studio` within the preview's userData directory. A normal Save in
an editor updates its managed working file. Apply captures a separate native
revision. Reopening preserves the saved working file, or copies the last applied
revision if the working file is missing.

**Native editor documents are not embedded in `.lf2` projects.** Saving a KerfDesk
project preserves its imported artwork, but transferring that project alone does
not transfer the PhotoCraft/VectorCraft editing session. Keep the preview's
session directory or save/export your native documents separately if you need
to move the editable source. The session list is local to this preview profile.

Finish and save work in the editor windows before closing them. The preview does
not force-close native editors, and after a KerfDesk restart an already open
editor window is not reattached automatically. The session list refuses reopening while the earlier disconnected editor process is still running. Close that window after saving, then reopen the session.

## Current limits

- These are companion windows with independent document and undo systems. There
  is no direct editable PhotoCraft-layer round trip inside a VectorCraft document
  yet, and the old studio has not been replaced.
- Artwork transfer is limited to 32 MB. Blank photo creation is limited to
  16 million pixels. The panel accepts physical dimensions up to 2000 mm;
  the pixel budget can impose a smaller photo size.
- Apply checks for document changes during saving/exporting and refuses a
  detected mismatch. Finish the edit and retry. A failed transfer can leave
  the native working file saved while no artwork was applied to KerfDesk.
- Vector export warnings need attention before applying. SVG import fidelity,
  clipping, effects and mixed image/vector designs still need broader review.
  This preview does not claim every upstream feature survives a machining handoff.
- VectorCraft 0.9.0 has an unauthenticated local TCP control channel. A random
  loopback port and restricted file roots reduce exposure but do not authenticate
  other software on the same computer. PhotoCraft uses a per-launch token.
- Native smoke results, renderer checks and hardware qualification are separate
  evidence. This preview has not established physical cutting/engraving results.

## Distribution status

The setup uses pinned upstream binaries locally. It does not add them to the
normal KerfDesk installer or authorise a public bundled release. The upstream
core has an MIT licence option, but dependencies, bundled fonts/assets, notices
and branding still need a distribution review. KerfDesk retains its own licence.

See [ADR-588](decisions/ADR-588-desktop-artcraft-studio-preview.md) for the
architecture and the pinned upstream protocol sources.



## Preview build and verification

The launcher builds a dedicated offline source-development app under
`.artcraft/preview-app`, using the project's existing development edition policy.
It does not change the shipping Pro access rules or reuse your installed profile.
For a previously built preview, `node scripts/start-artcraft-studio.mjs --skip-build`
opens it without rebuilding.

The renderer smoke uses the same app artifact:
`node scripts/artcraft-renderer-smoke.mjs`.
Its output records the source-development scope and actual browser observations.

Finish editing and keep the managed document selected while Apply is running.
Upstream save/export calls are separate commands, so the revision checks are not
an atomic lock against switching away and back between calls. Native saves use
the active document's own path, which avoids overwriting the managed file with
a different tab's contents.

Changed vector components may receive new default machining operations during
reimport. Review the imported geometry and operation settings after Apply.

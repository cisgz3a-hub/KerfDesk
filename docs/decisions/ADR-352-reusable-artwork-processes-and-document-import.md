## ADR-352 - Reusable artwork, processes and document import (2026-09-23)

**Status:** Accepted for the user-authorized follow-up to ADR-350. Local implementation and
software validation are distinct from publication, packaged-app and machine qualification.

### Context

The priority slice left distinct circular variable copies, complete reusable operation processes,
personal artwork/templates and broader artwork import as explicit gaps. The user asked to
implement those remaining items. PDF import therefore moves into scope; the previous PROJECT
exclusion no longer describes the authorized product.

### Decision

1. **All array modes can advance variables per copy.** Grid keeps its largest-rendered-envelope
   spacing. Circular centres each evaluated copy on the requested ring, without enlarging its
   radius to avoid overlap. Point Rotation uses the first evaluated selection's common centre and
   existing signed, exclusive-endpoint angles. Captured time, relative sequence spans, persistent
   schema-8 offsets, one-step undo and production-success advancement remain shared. Later value
   changes preserve manual positions. Text-on-path geometry already in world orientation does
   not apply the text rotation a second time.
2. **Process recipes capture one artwork's complete ordered operation plan.** Native material
   library version 2 adds named laser/CNC process recipes and accepts version 1. Enabled/visible
   flags, effective settings and referenced CNC cutters travel with the recipe. Applying creates
   independent operations for each selected target in one undo step. Colours adapt where required
   by the existing unique operation-colour representation. Path-specific bindings require matching
   destination path count/order. Artwork pixels/geometry, machine limits, stock, origin and
   clearance remain destination-owned. CNC retains its tool and clearing scheduler. Recipes are
   snapshots; single-preset Apply/Link remains available.
3. **My artwork is an offline personal library.** Selection capture includes editable objects,
   groups, text/fonts, masks/guides, complete source image/luma assets, operation copies and
   referenced CNC cutters. Separate IndexedDB storage loads when the library opens. Categories,
   search, delete, .lfart import/export and insertion with fresh identities are supported.
   Insertion preserves saved positions/order and is one undo transaction. Conflicting variable
   text data is reported instead of overwriting the destination dataset.
4. **A protected template is a complete project opened as new.** The versioned .lf2template
   envelope preserves unused operations, settings, notes and portable raster assets. Save
   template does not change ordinary Save ownership. Open template creates a dirty .lf2 project
   with no writable source target; the first Save requests a destination.
5. **PDF and PDF-compatible AI use explicit page selection.** Pinned PDF.js decodes off-thread.
   Simple complete path pages become editable centrelines with millimetre size, transforms,
   curves and path colours. Line/Fill cutting settings are chosen in the project. Text, clipping,
   images, transparency, unsupported drawing operations and differing fill/stroke colours use a
   rendered image of the whole page, with preview and DPI choice. Partial vector success cannot
   silently drop that content. Password-protected PDFs must be unlocked first. Legacy non-PDF
   Illustrator files must be exported as SVG or PDF-compatible AI.
6. **Additional raster formats retain explicit pixel meaning.** Browser-supported BMP uses
   embedded X/Y density. GIF becomes a frozen first/default frame encoded as PNG, keeping preview
   and emitted luma on the same animation frame. TIFF decoding is a lazy worker; selected pages
   preserve their original grid, all eight orientations and independent density axes, converted
   to 8-bit RGB over white for engraving. Missing density uses the existing 254-DPI default.
   Unsupported TIFF variants fail visibly instead of yielding incomplete pixels.
   Page images use the browser's actual canvas integer representation and drawing context;
   a guessed pixel-edge threshold does not refuse an otherwise representable import.
7. **HPGL/PLT is clean-room geometry import.** It follows the primary HP reference,
   40 plotter units/mm, ordered pen paths and explicit scale reference points. Unsupported text,
   clipping, PCL wrappers or drawing styles reject the whole file with a source diagnostic.
   Large input, command and generated-geometry counts produce advisories under ADR-268.
   Non-finite geometry, unsafe counts and actual JavaScript array representation failures remain
   errors. Filled boundaries and arbitrary pen colours are explained; worker cancellation remains
   available for large files.
8. **Ownership and lazy execution remain explicit.** Mixed files retain selection order;
   failed/cancelled pages consume no placement index. Project replacement invalidates completion.
   Heavy PDF/TIFF codecs are reached only by the requested import/worker path. PWA resource cache
   and initial download footprint are measured separately from decoder execution.

### Dependencies and asset provenance

PDF.js 6.3.289 (Apache-2.0) and tiff 7.1.3 (MIT) are pinned after reviewing their actual licences,
release sources and format boundaries under ADR-017. No CDN or widened script policy is needed:
PDF rendering uses upstream JavaScript image codecs with WASM disabled. Document scripting/XFA
is not enabled.

PDF.js includes old GPL Liberation fallback fonts. These are excluded from web emission and
desktop package inputs. The app instead bundles unmodified Liberation Sans 2.1.5 (OFL-1.1), with
source, hashes and licence in the existing font closure. Adobe CMap, Foxit/PDFium font and
JavaScript codec licences accompany emitted resources and generated notices. Package and separate
asset evidence remain distinct.

The unused PDF.js optional Node canvas dependency is removed through the exact parent/version
pnpm override. Browser rendering uses canvas supplied by Chromium; removing that edge keeps
unused native binaries out of the resolved production closure without relaxing the licence gate.

PDF resource files contribute 2,201,129 bytes when individually gzipped (CMaps 982,956;
fonts/licences 1,048,177; JavaScript image codecs/licences 169,996), before the decoder chunks.
This exceeds the historical 1-MB total bundle target. A hand-written PDF decoder, a renderer-only
browser embed, and first-use CDN/resource fetches were considered: they cannot provide the
required path conversion, complete page rendering and established offline guarantee together.
The accepted tradeoff is local precaching, including resource licences and the combined notices,
with decoder execution deferred until import. The
production build and startup module/worker inspection remain separate verification steps.

### Verification and boundaries

Regression fixtures cover exact coordinates/pixels, page selection, parser rejection, source
ownership, array persistence/placement, independent recipe bindings and emitted settings,
portable library/template data, undo and cancellation. Combined checks, dependency audit, bundle
footprint and rendered evidence are recorded in the follow-up audit report. Builds and simulated
results are not physical-machine, installed-app or hosted-release evidence. This work adds no
Start policy gate; completed Frame for the exact reviewed job remains the sole ordinary gate.

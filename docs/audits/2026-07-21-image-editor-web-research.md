# Image Studio — external research report (web sweep, 2026-07-21)

Companion evidence file for `2026-07-21-image-editor-research-and-roadmap.md`. Produced by a
web-research pass on 2026-07-21; every factual claim carries its source URL, and anything not
directly confirmed is marked UNVERIFIED. Constraint filter applied throughout: MIT-compatible
licensing only (no GPL/LGPL/AGPL/non-commercial), < 1 MB compressed web bundle, offline-only,
TypeScript strict, pure-TS core preference.

---

## A. LightBurn (reference product) — current as of 2.1.03, released 2026-06-30; no 2.2 exists

Version status source: https://lightburnsoftware.com/blogs/news and https://release.lightburnsoftware.com/LightBurn/Release/ (2.1.03 June 30, 2026 per search results).

### A1. The "Adjust Image" dialog (Alt/Option+I, right-click → Adjust Image)

Source: https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/ and legacy https://docs.lightburnsoftware.com/Tools/AdjustImage.html

- Layout: dual-pane — original image top-left, processed result top-right, live preview ("controls are live"). Announced in 0.9.21: https://lightburnsoftware.com/blogs/news/lightburn-0-9-21-image-adjustment-window-image-compositing-measure-tool-new-file-format-memory-savings-and-much-more
- Two settings groups:
  - **Layer Settings** (left) — the same settings as the Cut Settings Editor's Image mode, i.e. it previews the dither/image mode result in-dialog (mode dropdown, line interval/DPI, etc. — the docs page defers the list to "Cut Settings — Image Mode").
  - **Image Settings** — **Brightness**, **Contrast**, **Gamma** (sliders + numeric entry; named explicitly in docs), plus **Enhance Amount** and **Enhance Radius**.
- **Enhance Amount / Enhance Radius** = unsharp masking / high-pass sharpening. Confirmed via Shape Properties docs (https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/ — "Enhance increases the contrast of edges… also known as Unsharp Masking and High-Pass Sharpening"; Amount = intensity, Radius = spread) and a dev quote on the forum: "Radius is how many pixels around a central one to affect, and Amount is how strong to make the enhancement effect – you need both" (https://forum.lightburnsoftware.com/t/adjust-image-enhance-radius-enhance-amount-function-not-working/147055).
- **Invert Display** toggle (preview-side inversion).
- **Presets**: two built-ins — "Basic" and "Black Paint on White" (inverted, for dark surfaces) — plus user presets with Save/Delete/Import/Export (docs + https://support.salasers.com/adjust-image-settings-lightburn). The built-in "Basic" preset ships Enhance Amount = 250 (forum 147055).
- These same image properties are also editable per-image in the Shape Properties window (https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/).

### A2. Full image mode / dither list (Cut Settings Editor, Image mode)

Source: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/ (and legacy https://docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html)

Exactly 10 modes:

1. **Threshold** — hard on/off per pixel
2. **Ordered** — ordered-grid dithering
3. **Atkinson** — error diffusion, higher contrast, good for precise-dot materials
4. **Dither** — error diffusion for smooth photos (community treats this as Floyd-Steinberg; the docs only call it "Dither" — FS identity **UNVERIFIED** in official docs)
5. **Stucki** — error diffusion, slightly faster than Jarvis
6. **Jarvis** — error diffusion, generally best for photos
7. **Newsprint** — decorative newsprint-style halftone pattern
8. **Halftone** — variable-size cells; extra parameters **cells per inch** and **angle** (angle only enabled in Halftone mode — https://forum.lightburnsoftware.com/t/halftone-questions-angle/16438 + docs)
9. **Sketch** — edge-detect/highpass; engraves only hard edges
10. **Grayscale** — maps shades to power between Min/Max Power (true grayscale power modulation)

Supporting per-layer image settings: Line Interval / DPI, Dot Width Correction, Bi-directional scanning, Negative Image, Overscanning, Scan Angle, Angle Increment, **Pass-Through** (use image as-is, no resample), Number of Passes, Z Offset (same docs page).

### A3. Bitmap editing beyond adjustment — the complete tool set

Source: Tools menu reference https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/

- **Adjust Image** (above)
- **Trace Image** (Alt+T) — bitmap→vector with Cutoff + Threshold sliders and "ignore less than N px" noise filter (https://docs.lightburnsoftware.com/Tools/TracingImages.html)
- **Multi-File Trace Image** (Labs; added in 2.0) — batch tracing
- **Apply Mask to Image** — live, non-destructive crop-to-any-closed-shape(s); multiple shapes must be grouped on one layer; removable via "Remove Mask from Image" (https://docs.lightburnsoftware.com/2.1/Reference/ApplyMaskToImage/, https://docs.lightburnsoftware.com/ImageMasking.html)
- **Crop Image** — flattens the mask permanently (same docs)
- **Convert to Bitmap** — rasterize vectors
- **Save Processed Bitmap** — export the dithered/processed result
- Image compositing: multiple overlapping images fill together with transparency preserved (0.9.21 blog, URL above)
- 2.1 additions: **16-bit depth-map engraving** (Galvo 3D), **Undo History window**, Quick Nest (https://docs.lightburnsoftware.com/2.1/NewFeatures/NewIn2.1/, https://lightburnsoftware.com/blogs/news/lightburn-2-1-quick-nest-enhanced-camera-support-undo-history-and-more)
- 2.0 additions relevant to images: Multi-File Trace (Labs), alpha-channel support in AI imports, AprilTags camera calibration; otherwise 2.0 was a Qt6 framework migration, not an image-editing release (https://docs.lightburnsoftware.com/2.0/NewFeatures/NewIn2.0/, https://lightburnsoftware.com/blogs/news/lightburn-2-0-00-new-shapes-edit-nodes-submenu-dark-mode-and-more)

### A4. What LightBurn CANNOT do (users sent elsewhere)

- **No background removal.** Staff on the official forum: "I would use one of the many out there. Like remove.bg" — the in-app answer is manual masking with hand-drawn shapes (https://forum.lightburnsoftware.com/t/is-there-a-way-to-remove-back-ground-from-a-photo-with-lb/132960).
- **No tonal-range tools (levels/curves/dodge/burn).** Users report doing dodge/burn in GIMP, tonal compression in Photoshop, or preprocessing on Imag-R: "I've found getting the 'range' of the image critical… I use gimp to dodge/burn" (https://forum.lightburnsoftware.com/t/photo-editing-for-lightburn/77799).
- **No pixel painting, eraser, clone/heal, or spot cleanup** — none appear in the official Tools menu reference (evidence by omission from https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/; forum threads like https://forum.lightburnsoftware.com/t/erasing-background/103818 route users to masking/trace instead).
- **No freeform rectangle crop** — cropping requires drawing a mask shape first (mask/crop flow above; user confusion thread: https://forum.lightburnsoftware.com/t/image-mask-crop-tool-cropping-question-issue/39484).
- General photo-prep threads routinely recommend GIMP/Photoshop/Imag-R for anything beyond brightness/contrast/gamma/sharpen (https://forum.lightburnsoftware.com/t/photo-prep-file-type/42091, https://forum.lightburnsoftware.com/t/how-to-edit-an-image/108753).

**Product gap summary:** LightBurn's raster story = one adjustment dialog (5 sliders + invert + presets) + shape-based mask/crop + trace + 10 output modes. Everything else is outsourced to external editors. That is the bar to exceed.

---

## B. Competitor laser software

- **xTool Creative Space / xTool Studio** — the strongest bundled image editor in the category. AI Cutout (one-click background removal), AI Expand (outpainting), Magic Eraser (color-similarity pixel erase with "Fuzziness"), Magic Wand selection, filters (original, grid, sketch, comic 1/2, embossment, black-and-white, with strength), adjustments (brightness, contrast, temperature, saturation, sharpness). XCS ended at v2.7; development continues in successor "xTool Studio". Sources: https://support.xtool.com/article/1022, https://support.xtool.com/article/605, https://support.xtool.com/article/1773, https://xtool.zendesk.com/hc/en-us/articles/14622539900183-xTool-Creative-Space-XCS-Editor-Function-Description
- **Glowforge app** — cloud app; free tier has trace/outline/shapes/text; Premium adds a graphics/font library plus AI generation ("Magic Canvas" text-to-artwork, Magic SVG) and photo-optimized engrave presets ("Draft Photo" etc.). No conventional pixel-editing suite (no clone/heal/levels) found in docs — absence beyond listed tools **UNVERIFIED**. Sources: https://glowforge.com/b/premium, https://support.glowforge.com/hc/en-us/articles/4605387818267-glowforge-premium-account-faq, https://support.glowforge.com/hc/en-us/articles/360034142473-Engrave-and-Cut-Out-a-Photo, https://glowforge.com/latest-improvements/glowforge-both-in-and-on-your-apple-device-giant-materials
- **MillMage** (LightBurn Software's CNC sibling, launched 2025) — reuses LightBurn-style design/image machinery; docs reference image adjustment (brightness/contrast/gamma) and Shape Properties image settings; docs are prerelease and the dither-mode list could not be retrieved (fetch 404) — specifics **UNVERIFIED**. Sources: https://lightburnsoftware.com/blogs/news/millmage-is-here, https://docs.millmagesoftware.com/latest/, https://docs.millmagesoftware.com/latest/Reference/ShapeProperties/
- **EZCAD2** (galvo marking standard) — primitive but real bitmap pipeline: Invert (negative), Gray (256-level grayscale), Dither (dot-density grey simulation "similar to Grey Adjust in Photoshop" per manual), brightness/lighting edits, DPI change on dithered bitmaps, plus hatch fills. Sources: https://www.linxuanlaser.com/draw-menu-bitmap/, https://support.thunderlaser.com/portal/en/kb/articles/how-to-use-ezcad2-to-mark-bitmap, https://hispeedlaser.com/wp-content/uploads/2025/12/laser-software-EzCad-2-User-Manual.pdf

Takeaway: xTool is the only laser vendor shipping "consumer photo editor + AI" tools in-app; LightBurn/MillMage ship adjustment-only; a full in-app raster editor would leapfrog both.

---

## C. Open-source / embeddable web image editors

- **miniPaint** (https://github.com/viliusle/miniPaint) — **MIT** (https://github.com/viliusle/miniPaint/blob/master/MIT-LICENSE.txt). Actively maintained: v4.14.3 released 2026-04-20, 828 commits, 3.4k stars. Vanilla JS (~93%) + HTML5 canvas, client-side only, real layer system. Tools: pencil, brush, magic wand, eraser, fill, clone, blur, sharpen, crop, text; effects incl. dither, emboss, edge, Instagram-style filters; PNG/JPG/BMP/WEBP/GIF/TIFF + JSON layer format. **Verdict:** the only license-safe, alive, full-featured OSS editor — but it's an application, not a library: vanilla-JS monolith, no TS types, architecture incompatible with this repo's strict-TS/pure-core/250-line rules. Best used as a feature checklist and algorithm reference, not embedded.
- **Photopea** (https://www.photopea.com) — closed-source, commercial. Single developer (Ivan Kutskir), ~100k+ lines of hand-written JavaScript + GLSL; all computation client-side; WebGL used selectively for blending modes, masking weighted averages, and canvas zooming; PSD parsed/rendered entirely in JS. Sources: https://en.wikipedia.org/wiki/Photopea, https://news.ycombinator.com/item?id=26768550, https://www.failory.com/interview/photopea, https://gigazine.net/gsc_news/en/20181111-photopea-developer-ask-question/. **Verdict:** inspiration only — but it's the existence proof that one disciplined dev can ship Photoshop-grade in browser JS with selective WebGL.
- **Filerobot Image Editor** (https://github.com/scaleflex/filerobot-image-editor) — **MIT**. React + vanilla adapter; crop/resize/rotate/flip, finetunes (brightness/contrast/exposure/saturation), stock filters, annotation. **Verdict:** a "profile-picture editor" scope; no layers, no pixel tools; not Photoshop-grade. (README notes React 18 unsupported at time of search.)
- **toast-ui image-editor** (https://github.com/nhn/tui.image-editor) — **MIT**, built on fabric.js. Effectively **dead**: last npm publish 3.15.3 ~4 years ago; unmaintained since ~2022 (https://www.npmjs.com/package/tui-image-editor). **Verdict:** avoid.
- **Pintura** (https://pqina.nl/pintura/) — commercial/closed SDK, vanilla JS, no deps; license tiers (Personal restricted to <$100k solo companies; Small Business ~$749/yr per affiliate page; Enterprise/OEM above) — https://pqina.nl/pintura/pricing/, https://pqina.nl/pintura/license/. **Verdict:** polished crop/annotate/filter widget, not a layered raster editor; recurring license + closed source conflict with in-house control.
- **fabric.js** (https://github.com/fabricjs/fabric.js) — MIT (per npm https://www.npmjs.com/package/fabric; license text inferred from listings rather than displayed — **weakly verified**). v6 shipped 2024-07-15; now v7.x, actively maintained. **Verdict:** object-model/vector canvas with WebGL filters — the wrong substrate for a tiled pixel engine, and this app already has its own scene model.
- **tldraw** (https://tldraw.dev/community/license) — custom non-OSS license since 2.0: free with mandatory "Made with tldraw" watermark; ~$6,000/yr business license to remove (https://biggo.com/news/202509190115_tldraw_SDK_4.0_Licensing_Debate, https://tldraw.substack.com/p/license-updates-for-the-tldraw-sdk). Whiteboard/vector SDK. **Verdict:** wrong domain + license friction; not applicable.
- **Graphite** (https://github.com/GraphiteEditor/Graphite, https://graphite.art/license/) — **Apache 2.0**, Rust→WASM, node-based procedural vector+raster editor; 2025 alpha targets vector as primary, raster explicitly experimental (basic brush, filters, known performance issues; GPU raster/marquee selection slated later in 2025) — https://digitalproduction.com/2025/07/14/graphite-open%E2%80%91source-vector-design-tool-with-a-twist/. **Verdict:** most important newcomer to watch (license-safe, ambitious), but not an embeddable TS component and raster is immature — not adoptable now.

---

## D. Pixel-engine libraries + techniques

### D1. Libraries (license / size / maintained / verdict)

| Library | License | Rough size | Maintained? | Verdict |
|---|---|---|---|---|
| **OpenCV.js** | Apache 2.0 | ~7.6-8 MB default; ~4.2 MB trimmed custom builds reported | Yes (OpenCV project) | Only as an optional, lazy-loaded module (GrabCut/inpaint); far over a <1 MB PWA budget. Custom-build script: https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html; size reports: https://answers.opencv.org/question/229032/opencv_jswasm-is-too-large/, https://lambda-it.ch/blog/build-opencv-js |
| **photon-rs** | Apache 2.0 | WASM module; exact size **UNVERIFIED** | Semi (releases ongoing) | 96+ ops (adjust/convolve/channels/transform); fine license, but overlaps what pure TS does easily; adds a WASM toolchain. https://github.com/silvia-odwyer/photon, https://crates.io/crates/photon-rs |
| **wasm-vips** | **LGPL-2.1-or-later** (inherits libvips) | ~4.6 MB wasm; needs SIMD + exception handling | Yes | **Avoid**: LGPL in a statically-bundled WASM + 4.6 MB. https://github.com/kleisauke/wasm-vips, https://www.libvips.org/2020/09/01/libvips-for-webassembly.html |
| **glfx.js** | MIT | tiny | **No** — last substantive commit 2013-07-30; trivial fixes 2021/2022 | Dead; use as MIT-licensed shader reference (unsharp, curves, halftone-dot shaders). https://github.com/evanw/glfx.js, commits: https://github.com/evanw/glfx.js/commits/master |
| **Jimp** | MIT | pure JS, no native deps | Yes (v1.6.1, 2026) | Works in browser but 40-50x slower than native paths for heavy ops; not for an interactive editor loop. https://github.com/jimp-dev/jimp, https://www.pkgpulse.com/guides/best-javascript-image-processing-2026 |
| **image-js** | MIT (**UNVERIFIED** — inferred from npm listings) | pure JS | Yes | Analysis-oriented (ROI/masks/stats); same perf caveat as Jimp. https://npm-compare.com/image-js,jimp,sharp |
| **sharp** | Apache 2.0 (libvips native) | n/a | Yes | **Node-only** — irrelevant to the browser app. https://npm-compare.com/image-js,jimp,sharp |
| **onnxruntime-web / transformers.js** | MIT / Apache 2.0 (**UNVERIFIED from primary source** — widely published) | runtime multi-MB + model weights (tens of MB) | Yes | Runtime licenses fine; the blocker is model weights + size (below). https://github.com/huggingface/transformers.js/pull/1216, https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/ |

**Background-removal licensing (settled):**

- **BRIA RMBG-1.4 / RMBG-2.0: NOT commercial-safe** — CC BY-NC-style "non-commercial; commercial use subject to a commercial agreement with BRIA" (https://huggingface.co/briaai/RMBG-1.4, https://huggingface.co/briaai/RMBG-2.0). Do not bundle or auto-download.
- **MODNet: Apache 2.0** incl. models/demos ("The code, models, and demos… are released under the Apache License 2.0" — https://github.com/ZHKKKe/MODNet). **U-2-Net: Apache 2.0** (https://github.com/xuebinqin/U-2-Net). These are the commercial-safe ML options — but weights are multi-MB, so with an offline-only app and <1 MB bundle budget, ML background removal is out for v1; classical methods (border flood fill + color distance; magic-wand tolerance selection) need **zero dependencies** and cover the dominant laser use case (solid/white background product photos and clipart). GrabCut exists in OpenCV.js if ever needed (Apache 2.0, but the 4+ MB cost above).

### D2. Techniques (one authoritative source each)

- **Tiled canvas documents:** shipping raster editors store layers as sparse fixed-size tiles so edits/undo touch only dirty tiles; e.g., the MDP (FireAlpaca/MediBang) format stores layer pixel data as a sparse grid of **128×128 tiles**, only materializing non-transparent tiles (https://deepwiki.com/weeb-poly/krita-plugin-mdp/2.4-tile-image-data-(cimagetile)). Editor tile sizes cluster in the 64-256 px range; a specific "Photoshop uses N" claim is **UNVERIFIED**. Copy-on-write of dirty tiles is what makes deep undo affordable (store only pre-edit tiles, not full-frame snapshots).
- **Brush stamping:** a stroke is a polyline resampled into stamps at a **spacing** fraction of brush diameter ("distance between the individual stamps… small values allow continuous lines but are more expensive" — Adobe Substance 3D Painter docs, https://helpx.adobe.com/substance-3d-painter/painting/tool-list/paint-brush.html); **hardness** = radial alpha falloff at the stamp edge (https://design.tutsplus.com/articles/digital-painting-101-get-to-know-the-brush-panel--cms-23051); **flow** accumulates per stamp while **opacity** caps the whole stroke ("paint flowing out of the brush is fully opaque, just flowing at a reduced rate" — https://f64academy.com/brush-flow-vs-opacity-photoshop/).
- **Magic wand + marching ants:** the canonical implementation pair is the losingfight.com series — magic wand as tolerance-based region grow using scanline flood fill into a 1-bit mask, then marching ants rendered from the mask's traced boundary with an animated dash phase (https://losingfight.com/blog/2007/08/28/how-to-implement-a-magic-wand-tool/ and https://losingfight.com/blog/2007/08/30/an-alternate-way-to-implement-marching-ants/). Scanline flood fill fills whole horizontal runs and only pushes endpoints of neighboring unfilled runs (https://algocademy.com/blog/implementing-flood-fill-algorithms-a-comprehensive-guide/).
- **Off-main-thread filters:** OffscreenCanvas moves canvas rendering (2D/WebGL2/WebGPU contexts) into Web Workers with transferable ImageBitmaps — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas, https://web.dev/articles/offscreen-canvas. WebGL2 gives realtime slider adjustments (brightness/contrast/gamma as per-pixel shader or LUT texture); glfx.js (MIT) and WebGLImageFilter (https://github.com/phoboslab/WebGLImageFilter) are reference implementations. Specific 3D-LUT color-grading articles: not fetched — **UNVERIFIED**.
- **Healing/inpainting:** the family standard is **PatchMatch** (Barnes, Shechtman, Finkelstein, Goldman, SIGGRAPH 2009) — randomized nearest-neighbor patch correspondence; the basis of Photoshop CS5 Content-Aware Fill (paper: https://www.connellybarnes.com/work/publications/2011_patchmatch_cacm.pdf; https://eqn.princeton.edu/2010/06/patchmatch/). Caution: Adobe holds patents in this area (e.g., content-aware fill patents surfaced in search: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9396530) — patent risk for a commercial clone is real but its exact scope is **UNVERIFIED**; a simpler spot-heal (masked blur/median + edge-aware blend) avoids it.
- **Dithering:** the canonical error-diffusion reference is Tanner Helland's "Image Dithering: Eleven Algorithms and Source Code" — Floyd-Steinberg, Jarvis-Judice-Ninke, Stucki, Atkinson, Burkes, Sierra (3-row), Two-Row Sierra, Sierra Lite, false Floyd-Steinberg, plus ordered/Bayer (https://tannerhelland.com/2012/12/28/dithering-eleven-algorithms-source-code.html; kernel math also at https://beltoforion.de/en/dithering/). Laser-community table stakes = exactly LightBurn's menu (Threshold/Ordered/Atkinson/Dither/Stucki/Jarvis/Newsprint/Halftone/Sketch/Grayscale — docs URL in A2), with vendor guides steering photo work to Jarvis/Stucki/Atkinson (https://omtech.com/blogs/software/lightburn-photo-engraving-settings, https://blog.commarker.com/archives/21993). KerfDesk already implements 11 dither algorithms; the competitive gaps are **Newsprint, Halftone (cells-per-inch + screen angle), and Sketch** — all three are pattern/screen or edge modes, not error diffusion.

---

## Recommendations (as delivered by the research pass)

1. **Build-vs-buy: BUILD the editor core in pure TS.** No candidate survives the constraint filter (dead, crop-widget-scope, paid/closed, LGPL, non-embeddable, or architecture-incompatible — details above). Photopea proves the build path is feasible in browser JS with selective WebGL.
2. **Adopt almost nothing; re-implement the short list**: composed 256-entry LUTs for brightness/contrast/gamma; unsharp mask matching Enhance Amount/Radius; halftone + newsprint screens; Sketch (highpass/edge); scanline flood fill + tolerance wand; marching ants from mask boundary; masking/crop; invert; resize/resample. Optional far-future lazy-loads only: trimmed OpenCV.js (GrabCut/inpaint class), onnxruntime-web + MODNet/U-2-Net (never RMBG). Reference-read but never depend on: glfx.js, miniPaint, Tanner Helland.
3. **Ten highest-value image ops for laser users** (demand-evidenced, roughly ordered): brightness/contrast/gamma with live dithered preview; unsharp (Enhance) parity; the three missing modes (Halftone with cells/inch + angle, Newsprint, Sketch); background removal (classical first); levels/tonal-range mapping with histogram; live mask + one-drag rect crop; invert/negative; eraser/magic-eraser + spot cleanup; denoise/despeckle feeding Trace; DPI-aware resize/resample + pass-through. (Source URLs for each in sections A/B/D above.)

**Not verified in this research:** LightBurn "Dither" = Floyd-Steinberg (community consensus, absent from docs); exact photon-rs WASM size; image-js/onnxruntime-web/transformers.js licenses from primary sources; Photoshop's internal tile size; 3D-LUT grading articles; scope of Adobe's content-aware-fill patents; MillMage's dither list; whether Glowforge has any pixel tools beyond those listed.

# Generated learning pictures

The built-in image generation tool produced the pictures, except the tapered ball-nose bit picture, which is rendered from the modeled cutter law (ADR-368). Research, source review and visual inspection guide their use; neither generated nor rendered output is evidence of a real machining or engraving result.

The final web assets are in `public/tutorial-images/`. The metadata modules `tutorial-photo-assets.ts` and `bit-photo-assets.ts` contain filenames, dimensions and byte counts only. The complete prompt sets and local original-image provenance are in [generated-image-sources.json](generated-image-sources.json) and [bit-image-sources.json](bit-image-sources.json). Original PNG paths are production records, not runtime dependencies. Only the compressed files are shipped.

## Accuracy decisions

- **Registration:** a rectangular outline is burned on stationary wood, then a tan leather keychain is placed within it and engraved at the unchanged coordinates. The app's Rectangle jig has square corners, so the picture shows the blank's bounding rectangle, not a generated custom leather contour. The original wooden-keychain variant and an incorrect rounded jig outline were rejected. The instructions distinguish wood-marking focus/settings from leather focus/settings and require a separate completed Frame for each exact job. The machine follows known coordinates; there is no automatic blank detection.
- **Laser Line:** surface marking and cutting through are alternative results determined by tested settings and material. The storyboard does not prescribe a sequence or universal settings.
- **Laser Fill:** the ring is covered by parallel rows and its centre stays clear. The caption explicitly says the boundary illustration does not require a separate outline burn.
- **Image engraving:** the dotted example explains dithering. It does not represent Grayscale mode, which varies power instead.
- **CNC Pocket:** the photograph shows an enclosed flat recess, a remaining floor and rounded inside corners. The written island instructions separately require a compound outline with an inner hole.
- **V-carve:** the two channels show sloping faces and increased width with increased depth; no arbitrary depth or angle is presented as a setting.
- **Profile / tabs:** one photograph shows an oval retained by four bridges. It explains attachment, while the actual job controls determine tab dimensions and positions.
- **Box:** a single assembled open-top box illustrates the physical result. An earlier storyboard with inaccurate panel relationships was rejected. Flat assembly layout and the distinct fit-coupon tool retain their dedicated diagrams.
- **CNC cutters:** the 15 generated family pictures follow the manufacturer references recorded in the bit prompt set. Visual review checked flat versus hemispherical versus pointed/tipped-off ends, straight versus spiral flutes, opposite upcut/downcut directions, the compression cutter's opposing flute sections, and broad mortise/core-box heads. The O-flute ball-nose image was edited to correct its helix. These are generic family illustrations, not photographs of an exact catalogue SKU or scaled tool measurements. The tapered ball-nose picture is a three.js render of Amana 46282's modeled geometry from [its scene file](bit-renders/bit-tapered-ball-nose.html); its right-hand upcut flutes, shank length and lighting are illustrative.

The app implementation is the primary source for its labels, gestures, supported geometry and availability. The [design](accuracy-audit-design.md) and [machine](accuracy-audit-machine.md) audits document principal-source checks across all 93 lessons. External sources validate physical concepts and image briefs without importing another product's UI or machine settings:

- [Epilog keychain jig workflow](https://support.epiloglaser.com/laser-machine/fusion-edge/projects/wood-keychain/) and [leather-item jig workflow](https://support.epiloglaser.com/staging/laser-machine/legacy/usage-and-operation/software-techniques/use-a-jig-to-pre-engrave-an-item-for-customization-later/) explain registering an item to prepared geometry and changing which artwork is output. Their cut-out jigs differ from this user's burned wood outline.
- [LightBurn Fill documentation](https://docs.lightburnsoftware.com/1.7/Reference/CutSettingsEditor/FillMode/) explains parallel scan rows, excluded inner areas, and the distinction from Line and Image processing.
- [Vectric Pocket documentation](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/uiPocketMachineForm/) describes clearing enclosed material to a depth. [Vectric profile/tab documentation](https://docs.vectric.com/docs/V12.0/VCarveDesktop/ENU/Help/page/single-page/) explains retaining cut parts with bridges.
- The cutter references are primary manufacturer pages from Whiteside, Amana, Carbide 3D, Inventables and Harvey Tool; each prompt entry links its relevant source.

## Transfer and rendering budget

| Asset | Small variant | Large variant | Enforced file limit |
| --- | --- | --- | --- |
| Lesson example | 480 px wide | 960 px wide | 32 KiB / 100 KiB |
| CNC bit | 320 px square | 640 px square | 8 KiB / 16 KiB |

Actual bit files are about 1–2 KiB at 320 px and 3–7 KiB at 640 px. The largest lesson variant is under 90 KB. The registration storyboard is 29,878 / 85,476 bytes. All three storyboard stages share a single file; advancing stages changes a CSS crop and does not request another image.

Images use `srcset`, accurate `sizes`, native lazy loading and asynchronous decoding. Explicit dimensions and a reserved aspect ratio keep the space stable during loading, following [browser image-loading guidance](https://web.dev/articles/browser-level-image-lazy-loading). Conditional mounting is the main download boundary: a hidden image is not left in the DOM waiting for browser heuristics. The [PWA audit](image-delivery-audit.md) documents the bounded, on-demand offline cache and unseen-image fallback.

The encoder used the existing Sharp dependency, `resize({ width })` followed by `webp({ quality: 72, effort: 6 })`. Filenames include the first ten hexadecimal characters of the output's SHA-256 hash. Re-encoding uses a new content hash and updates the metadata; it must never silently replace bytes at a cached URL. No image library is added to the client bundle.

Asset tests read actual WebP headers and file bytes, verify responsive dimensions, filenames/hashes and byte budgets, and reject unreferenced files. Reader tests exercise deferred mounting, stage mapping, navigation, error fallback/retry and project-state isolation. Browser checks separately verify the production network behavior; these tests do not qualify hardware or material output.

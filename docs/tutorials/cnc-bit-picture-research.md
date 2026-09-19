# CNC bit picture research

Primary sources were read on 2026-09-19 before the image briefs were sent for generation. These are original generic family illustrations, not manufacturer product photographs or exact representations of a catalog item.

## Source and shape briefs

All briefs use a single isolated cutter, shank up and tip down, a clear three-quarter view of the cutting end, and a neutral background. No dimensions, logos, bearings, holders, or cutting settings should be generated into the image. Flute counts shown by a representative image do not supply metadata to the selected tool.

| Asset key | Required visual distinction | Primary source |
| --- | --- | --- |
| `bit-straight` | Parallel cylindrical sides, straight axial cutting edges, flat bottom and square cutting corners. | [Whiteside SC33](https://www.whitesiderouterbits.com/products/sc33), a solid-carbide straight cutter used for flat-bottom veining. The catalog's Onsrud PDF failed retrieval, so this manufacturer alternative was used. |
| `bit-upcut` | Flat end, constant cutting diameter and an upcut helix. In normal rotation chips move toward the shank. | [Whiteside RU2100](https://www.whitesiderouterbits.com/products/ru2100). |
| `bit-downcut` | Same flat-ended cutting envelope, with the opposite helix. Chips move toward the tip. | [Whiteside RD2100](https://www.whitesiderouterbits.com/products/rd2100). |
| `bit-compression` | Flat end; a short upcut tip section meets a longer downcut section, with a visible reversal of helix. No ball or point. | [Whiteside UD2100](https://www.whitesiderouterbits.com/products/ud2100), corroborating the catalog's [Amana compression family](https://www.amanatool.com/pub/media/productattachments/Solid-Carbide-Spektra-Compression-Spirals-for-Baltic-Plywood_v4.pdf). |
| `bit-o-flute-upcut` | One broad, rounded, open O-flute with an upcut spiral and a flat end. | [Amana single O-flute family](https://www.amanatool.com/pub/media/productattachments/Aluminum-O-Flute-Speed-Chart-v6.pdf). |
| `bit-o-flute-downcut` | One broad O-flute with the opposite, downcut spiral and a flat end. | [Amana 51778-Z](https://www.amanatool.com/51778-z-solid-carbide-cnc-spiral-o-flute-aluminum-cutting-1-8-dia-x-3-4-x-1-4-shank-down-cut-zrn-coated-router-bit.html), a specific downcut example. |
| `bit-o-flute-straight` | One broad oval gullet with a straight axial edge; no helix; flat end. | [Whiteside SA1600](https://www.whitesiderouterbits.com/products/sa1600). |
| `bit-o-flute-double` | Two broad rounded gullets, a flat end and constant cutting diameter. A straight-flute example is used; the family also includes spiral products. | [Amana double O-flute straight family](https://www.amanatool.com/pub/media/custom/upload/File-1460474484.pdf) and [plastic-cutting range](https://www.amanatool.com/products/router-bits/plastic-cutting-router-bits.html). |
| `bit-mortise` | Short, broad, flat-bottom head on a narrower shank, with short downshear cutting edges. No bearing or pilot. | [Whiteside 1300](https://www.whitesiderouterbits.com/products/1300). Its downshear detail corrects an overly simple initial straight-edge assumption. |
| `bit-ball-nose` | Untapered cylindrical cutting body ending in a full hemispherical nose, not a flat-bottom corner-radius or tapered cutter. | [Carbide 3D #202](https://shop.carbide3d.com/products/202-25-ball-cutter). |
| `bit-core-box` | Short round-nose router head, semicircular full-radius bottom, visible straight carbide edges, no bearing or pilot. Head may be wider than the shank. | [Whiteside 1403](https://www.whitesiderouterbits.com/products/1403), whose published radius is half the cutting diameter. |
| `bit-o-flute-ball-nose` | Full hemispherical nose with a broad O-flute and upcut helix; no tapered cutting profile. | [Amana O-flute ball-nose range](https://www.amanatool.com/products/cnc-router-bits/plastic-cutting-cnc-router-bits/solid-carbide-spiral-o-flute-ball-nose-plastic-cutting.html) identifies catalog products 51814 and 51818 as upcut. |
| `bit-v-groove` | Symmetrical conical V ending in a point; broad router cutting wings, no flat land or bearing. The representative angle is not the selected tool's measurement. | [Inventables 60-degree V-bit](https://www.inventables.com/products/carbide-tip-v-bit-60-degree-1-4-in-cutting-x-1-8-in-shank). |
| `bit-engraving-point` | Slender pointed taper with a relieved/split cutting face. No pyramid or radius tip. | [Harvey pointed engraving cutters](https://www.harveytool.com/products/specialty-profiles/engraving-cutters/pointed). |
| `bit-engraving-flat` | Slender taper ending in a small visible flat land, not a rounded tip or a full-width cylindrical bottom. | [Harvey tipped-off engraving cutters](https://www.harveytool.com/products-en-ca/specialty-profiles/engraving-cutters/tipped-off). |

## Mapping and supported shape boundaries

`src/core/scene/cnc-tool.ts` defines four geometry kinds: `end-mill`, `ball-nose`, `v-bit`, and `engraving`. Family is descriptive metadata, not a CAM branch. The picture mapper checks the geometry kind before accepting a known family, so a conflicting or unknown custom family cannot override the modeled shape. Unknown flat/ball families receive explicitly generic geometry examples, without claiming their actual flute design.

`src/core/cnc/radial-envelope.ts` uses a conical envelope for pointed tools and a truncated cone for engraving tools with a valid positive tip diameter. A blank or zero engraving tip diameter means a point. The pre-existing reference-only catalog reason that describes legacy engraving as a full flat cylinder is stale and was not reused. These UI changes do not alter its catalog availability or any CAM behavior.

The existing modeled catalog has 13 cutter families; engraving is also a selectable custom kind. The 15 image keys cover those catalog families plus pointed and flat-tip engraving. O-flute ball-nose entries exist in the catalog but previously fell into the generic optgroup; the chooser label now names the family. Its missing flute-count metadata is deliberately not inferred from a picture.

Reference-only cutters, including tapered balls, corner-radius tools, bearings and undercut profiles, receive no selectable photo cards. The picture does not validate a tool, set a feed, change dimensions or make an unsupported cutter available.

## Delivery and interaction

Cards appear beside the Startup default bit, each Tool Plan stage, the custom-bit form, modeled catalog family headings, and the tiling registration cutter. They are initially closed and contain no image element. A user can explicitly show the current shape, or changing a bit opens that selection's persistent card. The existing native selectors, draft/save behavior, and temporary 3D cutting-envelope toast remain intact. Closing a card unmounts its image; reopening uses ordinary browser/service-worker caching and retries any previously failed image.

Only the small URL/metadata module `src/ui/tutorials/bit-photo-assets.ts` is imported. No tutorial catalog or image binary is imported into the selector. Responsive WebP candidates use `BASE_URL`, matching hosted subpaths and Electron's relative asset path. Photo dimensions come from the generated manifest. If an image fails, the sourced shape description remains available.

Visual acceptance must distinguish the opposing upcut/downcut helices, the compression junction, the O-flute ball's upcut direction, the full ball radius, and the engraving tip flat. Root owns image generation, this visual review, compression, and file-integrity verification.

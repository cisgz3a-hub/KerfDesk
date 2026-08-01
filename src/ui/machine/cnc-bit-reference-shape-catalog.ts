import type { CatalogSourceScope, ReferenceCncBitCatalogEntry } from './cnc-bit-catalog-types';

const HARVEY_ENGRAVING = 'https://www.harveytool.com/products/specialty-profiles/engraving-cutters';
const HARVEY_TAPERED = 'https://www.harveytool.com/products/miniature-end-mills/tapered';
const HARVEY_ALL = 'https://www.harveytool.com/products/all-products';
const WHITESIDE_COLLECTIONS = 'https://www.whitesiderouterbits.com/collections';
const ONSRUD_CATALOG =
  'https://www.onsrud.com/images/LMT%20Onsrud%20Product%20Cutting%20Tools%20Catalog%20PCT-19.pdf';

export const REFERENCE_CNC_BIT_SHAPE_CATALOG: ReadonlyArray<ReferenceCncBitCatalogEntry> = [
  ref(
    'engraving-flat-tip',
    'Flat-tip engraving cutters',
    'Needs independent flat-tip width and included angle; the legacy engraving kernel is a full flat cylinder.',
    HARVEY_ENGRAVING,
  ),
  ref(
    'engraving-tipped-off',
    'Tipped-off engraving cutters',
    'Needs the manufactured tip-off diameter as well as the included angle.',
    HARVEY_ENGRAVING,
  ),
  ref(
    'engraving-tip-radius',
    'Tip-radius engraving cutters',
    'Needs a tip radius and tapered-side geometry that no current kernel stores.',
    HARVEY_ENGRAVING,
  ),
  ref(
    'engraving-pointed',
    'Pointed engraving cutters',
    'Potentially cone-compatible, but each selectable preset needs verified included angle and cutting diameter.',
    'https://www.harveytool.com/products/specialty-profiles/engraving-cutters/pointed',
  ),
  ref(
    'engraving-parallel',
    'Parallel square-end and ball-end engraving cutters',
    'Half-round drill-style geometry, vertical-wall cutting, and the square or ball transition profile need a dedicated engraving kernel.',
    'https://www.harveytool.com/products/specialty-profiles/engraving-cutters/parallel',
  ),
  ref(
    'double-angle-pointed',
    'Pointed double-angle cutters',
    'Potentially cone-compatible only when the point and included angle are verified per product.',
    'https://www.harveytool.com/products/double-angle-shank-cutters---pointed---reduced-shank',
  ),
  ref(
    'tapered-square',
    'Tapered square end mills',
    'Needs taper angle, tip diameter, and cutting length independently.',
    HARVEY_TAPERED,
  ),
  ref(
    'tapered-ball',
    'Tapered ball-nose cutters',
    'Needs independent ball radius, tip diameter, taper angle, and cutting length.',
    HARVEY_TAPERED,
  ),
  ref(
    'tapered-corner-radius',
    'Tapered corner-radius cutters',
    'Combines taper, flat center, and corner radius beyond the current profiles.',
    HARVEY_TAPERED,
  ),
  ref(
    'corner-radius',
    'Corner-radius / bull-nose cutters',
    'Needs a flat-center width plus corner radius; a full ball-nose profile is not equivalent.',
    'https://www.harveytool.com/products/material-specific-end-mills/aluminum-alloys/corner-radius',
  ),
  ref(
    'bowl-tray',
    'Bowl, tray, and dish cutters',
    'Their flat center and shoulder radius are not a full ball-nose profile.',
    'https://www.whitesiderouterbits.com/products/1370',
    'representative-product',
  ),
  ref(
    'fishtail',
    'Fishtail cutters',
    'The relieved center is not a flat-bottom kernel and must not clear floors or drill as one.',
    'https://www.inventables.com/products/carving-bit-super-pack',
    'representative-product',
  ),
  ref(
    'chamfer',
    'Chamfer and bevel cutters',
    'Often has a finite tip, pilot, or side-angle convention that cannot be stored as a point V-bit.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'back-chamfer',
    'Back-chamfer and non-pointed double-angle cutters',
    'Needs upper and lower cones, neck clearance, and an undercut-safe entry path.',
    HARVEY_ALL,
  ),
  ref(
    'runner',
    'Runner and full-round form cutters',
    'A compound concave/convex profile is not a full-radius ball end.',
    HARVEY_ALL,
  ),
  ref(
    'multi-axis-lens-oval',
    'Multi-axis lens and oval form cutters',
    'Tangential lens/oval radii and intended multi-axis contact geometry are not an untapered full-radius ball envelope.',
    'https://www.harveytool.com/products/material-specific-end-mills/aluminum-alloys/multi-axis-finishers',
  ),
  ref(
    'high-feed-form',
    'High-feed form end mills',
    'The proprietary end profile, theoretical radius, and non-center-cutting entry contract need dedicated geometry and toolpaths.',
    'https://www.harveytool.com/products/high-feed-end-mills-for-high-temp-alloys',
  ),
  ref(
    'acm-tcm-folding-v-groove',
    'ACM/TCM flat-tip folding V-groove cutters',
    'Finite flat-tip width and panel-folding depth semantics are not equivalent to the current point-cone V-bit kernel.',
    'https://www.amanatool.com/products/cnc-router-bits/aluminum-non-ferrous-metal-cutting-router-bits/double-edge-folding-insert-a-va-groove-with-flat-bottom-router-bits-for-aluminum-composite-material-acm-panels.html',
  ),
  ref(
    'surfacing',
    'Spoilboard, slab-flattening, surfacing, and flycutters',
    'Many are not center-cutting; they need Surfacing-only selection plus a ramp or lead-in contract.',
    'https://www.amanatool.com/45526-carbide-tipped-spoilboard-surfacing-rabbeting-flycutter-slab-leveler-surface-planer-flattening-1-1-2-dia-x-1-2-x-1-2-inch-shank-router-bit.html',
    'representative-product',
  ),
  ref(
    'roughing-chipbreaker',
    'Roughing and chipbreaker end mills',
    'The gross diameter is flat-compatible, but serrations, flute count, finish allowance, and plunge capability need explicit presets.',
    'https://www.whitesiderouterbits.com/collections/roughing-spiral-bits',
  ),
  ref(
    'slow-helix',
    'Slow-helix and three-flute square end mills',
    'The envelope is flat-compatible, but flute count and helix behavior need verified per-product entries.',
    ONSRUD_CATALOG,
  ),
  ref(
    'left-hand-reverse-rotation',
    'Left-hand and reverse-rotation cutters',
    'Requires explicit spindle-rotation compatibility; the current tool model cannot represent or enforce cutter rotation direction.',
    'https://www.whitesiderouterbits.com/collections/left-hand-spiral-bits',
  ),
  ref(
    'multi-flute-variable-helix',
    'Four-plus-flute, high-helix, and variable-helix end mills',
    'The gross envelope may be familiar, but flute count, helix geometry, material, and automatic-feed inputs need verified product data.',
    'https://www.harveytool.com/products/featured-solutions/metric-tooling/medium-alloy-steels',
  ),
  ref(
    'honeycomb-panel',
    'Honeycomb and panel cutters',
    'Toothed, hogger, and modular cutter assemblies need dedicated axial/radial geometry, engagement rules, and collision checks.',
    ONSRUD_CATALOG,
  ),
  ref(
    'foam',
    'Foam cutters',
    'Long-reach and material-specific foam tooling needs cutting-length, flute, deflection, and material-removal constraints.',
    ONSRUD_CATALOG,
  ),
  ref(
    'dovetail',
    'Dovetail cutters',
    'Needs neck, head, included-angle, entry, exit, and collision geometry.',
    'https://www.harveytool.com/products-en-ca/specialty-profiles/dovetail-cutters',
  ),
  ref(
    't-slot',
    'T-slot cutters',
    'Needs head and neck dimensions plus a legal slot-entry path.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'keyhole',
    'Keyhole cutters',
    'Needs head/neck geometry and a constrained plunge-and-slot operation.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'keyseat-woodruff',
    'Keyseat and Woodruff cutters',
    'Needs head width, neck clearance, arbor geometry, and side-entry collision checks.',
    'https://www.harveytool.com/products/specialty-profiles/keyseat-cutters',
  ),
  ref(
    'slotting-saw',
    'Slotting cutters, slitting saws, and arbor systems',
    'Needs blade thickness, arbor geometry, hub clearance, spindle compatibility, side-entry planning, and collision checks.',
    'https://www.harveytool.com/products-en-ca/en-ca-slitting-saws',
  ),
  ref(
    'rabbeting',
    'Rabbeting bits',
    'Often uses a bearing or pilot that constrains the effective step and collision envelope.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'lollipop-undercut',
    'Lollipop and 220°–300° undercut end mills',
    'Needs spherical/neck geometry and undercut-aware entry and collision planning.',
    'https://www.harveytool.com/products/specialty-profiles/undercutting-end-mills',
  ),
  ref(
    'flush-trim',
    'Flush-trim, pattern, and laminate-trim bits',
    'The bearing or pilot is not represented and must participate in collision and edge-following semantics.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'roundover',
    'Roundover and corner-round bits',
    'Needs edge radius, pilot/bearing, and vertical placement relative to the stock edge.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'point-plunge-roundover',
    'Point-cutting and plunge roundover/ovolo cutters',
    'Center-entry roundover and ovolo profiles need compound axial/radial geometry and a verified plunge contract, not an edge-bearing roundover model.',
    'https://www.amanatool.com/products/cnc-router-bits/profiling-cnc-router-bits/plunge-round-over-cnc-router-bits.html',
  ),
  ref(
    'beading',
    'Beading bits',
    'Uses a compound edge form plus bearing/pilot geometry.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'cove',
    'Cove bits',
    'A concave edge profile is not represented by a ball-nose removal kernel.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'ogee-molding',
    'Ogee, classical, and molding bits',
    'Compound edge profiles need a dedicated radial profile and bearing/pilot geometry.',
    WHITESIDE_COLLECTIONS,
  ),
  ref(
    'table-edge-handrail',
    'Table-edge and handrail bits',
    'Large compound profiles need exact radial geometry, stock-edge placement, and collision checks.',
    WHITESIDE_COLLECTIONS,
  ),
];

function ref(
  id: string,
  label: string,
  reason: string,
  sourceUrl: string,
  sourceScope: CatalogSourceScope = 'family-reference',
): ReferenceCncBitCatalogEntry {
  return {
    status: 'reference-only',
    id,
    familyLabel: label,
    label,
    reason,
    sourceUrl,
    sourceScope,
  };
}

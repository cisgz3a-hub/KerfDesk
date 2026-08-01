import type { CatalogSourceScope, ReferenceCncBitCatalogEntry } from './cnc-bit-catalog-types';

const AMANA_JOINERY = 'https://www.amanatool.com/products/router-bits/jointing-router-bits.html';
const HARVEY_HOLES = 'https://www.harveytool.com/products/holemaking';
const HARVEY_ALL = 'https://www.harveytool.com/products/all-products';
const ONSRUD_CATALOG =
  'https://www.onsrud.com/images/LMT%20Onsrud%20Product%20Cutting%20Tools%20Catalog%20PCT-19.pdf';

export const REFERENCE_CNC_BIT_OPERATION_CATALOG: ReadonlyArray<ReferenceCncBitCatalogEntry> = [
  ref(
    'tongue-groove',
    'Tongue-and-groove sets',
    'Matched multi-cutter profiles need exact stack geometry and stock-thickness setup.',
    AMANA_JOINERY,
  ),
  ref(
    'finger-box-joint',
    'Finger-joint and box-joint cutters',
    'Needs tooth pitch/profile plus a dedicated indexed joinery workflow.',
    AMANA_JOINERY,
  ),
  ref(
    'glue-joint',
    'Glue-joint cutters',
    'Interlocking profiles require exact vertical placement and dedicated mating-part semantics.',
    AMANA_JOINERY,
  ),
  ref(
    'lock-miter',
    'Lock-miter cutters',
    'Needs a compound profile, stock-thickness calibration, and paired-edge workflow.',
    AMANA_JOINERY,
  ),
  ref(
    'drawer-lock',
    'Drawer-lock cutters',
    'Needs a compound profile and dedicated mating-part offsets.',
    AMANA_JOINERY,
  ),
  ref(
    'raised-panel',
    'Raised-panel and back-cutters',
    'Large compound profiles and back-cut depth need panel-specific paths and collision checks.',
    AMANA_JOINERY,
  ),
  ref(
    'stile-rail',
    'Stile-and-rail sets',
    'Matched cope-and-stick profiles require coordinated cutters and stock setup.',
    AMANA_JOINERY,
  ),
  ref(
    'sash-window-weatherseal',
    'Sash, window, and weatherseal cutters',
    'Application-specific compound profiles need dedicated geometry and workflow constraints.',
    AMANA_JOINERY,
  ),
  ref(
    'twist-spot-brad-vpoint',
    'Twist, spot, brad-point, and V-point drills',
    'Needs point geometry, flute/cutting length, and drill-only lateral-motion restrictions.',
    HARVEY_HOLES,
  ),
  ref(
    'drill-end-mill',
    'Drill/end mills',
    'Combined drilling, grooving, milling, spotting, and chamfering need operation-aware geometry and entry constraints.',
    'https://www.harveytool.com/products-en-ca/specialty-profiles/drillend-mills',
  ),
  ref(
    'combination-drill-thread-mill',
    'Combination drill/thread mills',
    'One tool performs drilling, threading, thread relief, and chamfering, requiring thread parameters and a coordinated multi-stage toolpath.',
    'https://www.harveytool.com/products-en-ca/thread-milling-cutters/combination-drillthreadmill',
  ),
  ref(
    'combined-drill-countersink-counterbore',
    'Combined drill/countersink and drill/counterbore cutters',
    'The stepped pilot, cone or counterbore geometry, and coordinated bore-depth semantics exceed a single drill or end-mill envelope.',
    HARVEY_HOLES,
  ),
  ref(
    'forstner-hinge',
    'Forstner and hinge-boring drills',
    'Needs rim/spur geometry, non-lateral cutting rules, and bore-specific entry.',
    HARVEY_HOLES,
  ),
  ref(
    'flat-bottom-drill',
    'Flat-bottom drills',
    'Needs drill-only operation semantics despite the nominal flat floor.',
    HARVEY_HOLES,
  ),
  ref(
    'countersink',
    'Countersinks',
    'Needs pilot-hole context, cone geometry, target diameter, and drill-only placement.',
    HARVEY_HOLES,
  ),
  ref(
    'counterbore',
    'Counterbores',
    'Needs pilot geometry, stepped diameter, and bore-depth semantics.',
    HARVEY_HOLES,
  ),
  ref(
    'combination-step-drill',
    'Combination and step drills',
    'Multiple diameters and shoulders require a stepped axial profile and drill-only path.',
    HARVEY_HOLES,
  ),
  ref(
    'reamer',
    'Reamers',
    'Requires an existing-hole workflow, allowance, and non-side-cutting restrictions.',
    HARVEY_HOLES,
  ),
  ref(
    'hole-saw',
    'Hole saws and annular cutters',
    'Needs pilot/arbor geometry, annular removal, breakthrough handling, and drilling restrictions.',
    HARVEY_HOLES,
  ),
  ref(
    'plug-cutter',
    'Plug cutters',
    'Annular plug formation, inside-diameter sizing, depth, chip clearance, and non-lateral drilling behavior need a plug-cutting operation.',
    'https://www.amanatool.com/products/boring-drilling-bits/plug-cutters/plug-cutters.html',
  ),
  ref(
    'spade-drill',
    'Spade drills',
    'The 118-degree point, broad spade body, drilling-only engagement, and breakthrough behavior are not represented by the flat end-mill kernel.',
    'https://www.amanatool.com/products/boring-drilling-bits/drill-bits-for-non-ferrous-metals-steel-and-wood/solid-carbide-cnc-118-degree-spade-drill-router-bits.html',
  ),
  ref(
    'thread-mill',
    'Thread mills',
    'Needs pitch, hand, diameter, and a dedicated helical-interpolation toolpath.',
    'https://guhring.com/media/support/Tapping-Threadmill-CNC-Examples.pdf',
  ),
  ref(
    'cut-tap',
    'Cut taps',
    'Needs pitch/hand plus controller-supported synchronized or reversing tapping and a tap holder contract.',
    'https://guhring.com/Catalogs',
  ),
  ref(
    'form-tap',
    'Form taps',
    'Needs forming-specific pilot sizing, material constraints, and synchronized tapping capability.',
    'https://guhring.com/Catalogs',
  ),
  ref(
    'diamond-drag',
    'Diamond-drag and spring-loaded engraving tools',
    'Uses drag/pressure motion and normally no spindle rotation; rotary CAM semantics do not apply.',
    'https://www.2linc.com/engraving-tools/engraving-tool-bits/diamond-drag-engraving-tools/',
  ),
  ref(
    'drag-vinyl-knife',
    'Drag knives and vinyl cutters',
    'Blade-tip offset, swivel alignment, corner handling, spring force, and spindle-off operation need knife-specific toolpaths.',
    'https://shop.carbide3d.com/products/stingray-vinyl-cutter',
    'representative-product',
  ),
  ref(
    'tangential-oscillating-knife',
    'Tangential and oscillating knife systems',
    'Requires commanded blade orientation, optional oscillation, lift/actuation, compatible controls, and knife-specific corner motion.',
    'https://www.shopsabre.com/product/tangential-oscillating-knife-system/',
    'representative-product',
  ),
  ref(
    'driven-rotary-wheel-knife',
    'Driven rotary-wheel knives',
    'A motor-driven rotating blade needs blade RPM, rolling-cut contact, lift, compatible controls, and material-specific knife paths.',
    'https://www.zund.com/en/cutting-systems/modules-and-tools/power-rotary-tool-prt',
  ),
  ref(
    'v-cut-bevel-knife',
    'V-cut and bevel knife tools',
    'Commanded blade angle, orientation, paired V-cuts, lift, and knife-corner motion require dedicated knife geometry and controller semantics.',
    'https://www.zund.com/en/cutting-systems/modules-and-tools',
  ),
  ref(
    'rotary-burr-rasp',
    'Rotary burrs and rasps',
    'Tooth geometry, safe engagement, and material-removal behavior are not represented by end-mill CAM.',
    HARVEY_ALL,
  ),
  ref(
    'fiberglass-diamond-pattern',
    'Fiberglass diamond-pattern cutters',
    'Bidirectional abrasive-style teeth need material-specific feeds and a distinct removal model.',
    ONSRUD_CATALOG,
  ),
  ref(
    'abrasive-diamond-grit',
    'Abrasive and diamond-grit cutters',
    'Abrasive removal, wear, and safe engagement do not match fluted cutter semantics.',
    ONSRUD_CATALOG,
  ),
  ref(
    'industrial-form',
    'Concave-radius, backdraft, hexalobe, and other industrial form cutters',
    'Application-specific radial profiles need dedicated geometry and toolpath constraints.',
    HARVEY_ALL,
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

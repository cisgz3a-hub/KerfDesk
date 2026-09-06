# Loop 2 — geometry, transforms, units, bounds, and numeric integrity

Status: complete

Audited tree: `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, including the inherited working-tree changes.

## Audit design

This loop used invariant and metamorphic testing rather than another policy trace. The auditors followed geometry through three coordinate spaces — authored/local, transformed machine, and emitted coordinates — and challenged results under scale changes, representation changes, and size thresholds. SVG viewport behavior was compared with the W3C's normative transform algorithm. Bounds, non-finite handling, curve subdivision, compatibility geometry, job origins, and existing property-test coverage were sampled independently.

The primary and blind auditor independently found the same two curve-compilation defects. The adversarial verifier then challenged those against ADR-159, ADR-241, project validation, and all three laser/CNC consumers. A third SVG finding survived the verifier's narrower standards test.

## Research and verification base

Repository authorities:

- `PROJECT.md` non-negotiables 1–7
- `DECISIONS.md:2604-2645` (ADR-046), `:7518-7535` (ADR-159), `:10994-11045` (ADR-241), and ADR-268
- current geometry, compiler, importer, validator, and test paths cited per finding

External primary sources:

- W3C SVG 2, [Computing the equivalent transform of an SVG viewport](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform): missing `preserveAspectRatio` defaults to `xMidYMid meet`; `meet` makes the two scales uniform; viewBox minima and alignment contribute translation.
- W3C SVG 2, [`preserveAspectRatio`](https://www.w3.org/TR/SVG2/coords.html#PreserveAspectRatioAttribute): non-uniform fill is the explicit `none` mode, while the initial value preserves aspect ratio.
- W3C SVG 2, [`viewBox`](https://www.w3.org/TR/SVG2/coords.html#ViewBoxAttribute): the four-number rectangle is mapped to the viewport with the `preserveAspectRatio` rule.
- W3C SVG 2, [Paths](https://www.w3.org/TR/SVG2/paths.html): path coordinates, curves, and elliptical-arc correction rules were used as the parser/curve reference.
- W3C SVG 2, [Geometry Properties](https://www.w3.org/TR/SVG2/geometry.html) and [Units](https://www.w3.org/TR/SVG2/coords.html#Units): primitive coordinates and sizes are length/percentage values, percentages resolve against the viewport, and one inch is 96 CSS pixels.
- ECMA-262 2024, [Number Objects](https://tc39.es/ecma262/2024/multipage/numbers-and-dates.html) and [`parseFloat`](https://tc39.es/ecma262/multipage/global-object.html#sec-parsefloat-string): finite checks and longest-valid-prefix parsing were used when reviewing numeric boundaries.

Focused executable check:

```text
pnpm vitest run src/core/scene/curve-path.test.ts src/core/job/compile-job-curves.test.ts src/io/svg/parse-svg.test.ts src/io/svg/svg-transform-attribute.test.ts src/core/scene/transform.test.ts src/core/scene/selection-transform.test.ts src/core/job/job-origin.test.ts
6 discovered test files passed; 50 tests passed; exit 0
```

`svg-transform-attribute.test.ts` is not present and therefore was not discovered. The passing suite pins the current behavior; it does not refute the metamorphic counterexamples below.

An additional primitive-focused check passed 12 tests in `src/io/svg/shape-to-polylines.test.ts` (exit 0); all of its geometry attributes are unitless, which leaves the unit/percentage behavior below uncovered.

Read-only counterexample probes run by the independent auditor:

```powershell
node --experimental-strip-types --input-type=module -e 'const { flattenColoredPathCurves } = await import("./src/core/scene/curve-path.ts"); const count=100001; const path={color:"#f00",polylines:[{points:[{x:0,y:0},{x:0,y:1}],closed:false}],curves:[{start:{x:0,y:0},segments:Array.from({length:count},(_,i)=>({kind:"line",to:{x:i+1,y:0}})),closed:false}]}; const flattened=flattenColoredPathCurves(path,{toleranceMm:0.025,segmentBudget:100000}); console.log(JSON.stringify({flattened,compatibilityEnd:path.polylines[0].points.at(-1),canonicalEnd:path.curves[0].segments.at(-1).to}));'
```

Result: `{"flattened":{"kind":"segment-budget-exceeded","segmentBudget":100000},"compatibilityEnd":{"x":0,"y":1},"canonicalEnd":{"x":100001,"y":0}}`; exit 0.

```powershell
node --experimental-strip-types --input-type=module -e 'const { flattenCurveSubpath } = await import("./src/core/scene/curve-path.ts"); const path={start:{x:0,y:0},segments:[{kind:"cubic",control1:{x:0,y:1},control2:{x:1,y:1},to:{x:1,y:0}}],closed:false}; const result=flattenCurveSubpath(path,{toleranceMm:0.025,segmentBudget:100000}); if(result.kind!=="ok") throw new Error(result.kind); const scale=100; const pts=result.polyline.points.map(p=>({x:p.x*scale,y:p.y*scale})); const bez=t=>{const u=1-t;return{x:scale*(3*u*t*t+t*t*t),y:scale*(3*u*u*t+3*u*t*t)}}; const dseg=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y;const q=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-(a.x+q*dx),p.y-(a.y+q*dy))}; let max=0; for(let i=0;i<=10000;i++){const p=bez(i/10000);let best=Infinity;for(let j=1;j<pts.length;j++)best=Math.min(best,dseg(p,pts[j-1],pts[j]));max=Math.max(max,best)} console.log(JSON.stringify({localToleranceMm:0.025,objectScale:scale,segments:result.segmentCount,maxMachineDeviationMm:max}));'
```

Result: `{"localToleranceMm":0.025,"objectScale":100,"segments":8,"maxMachineDeviationMm":1.1717192056218815}`; exit 0.

## Reconciled findings

### L2-01 — object scaling expands curve-flattening error beyond the machine tolerance

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: a canonical cubic or arc is compiled from an object whose linear transform enlarges it.
- Mechanism: `src/core/scene/curve-path.ts:12-18` defines the machine tolerance as 0.025 mm; `src/core/job/compilation-polylines.ts:16-23` applies it in object-local coordinates. Laser line transforms only afterward in `src/core/job/compile-job.ts:331-337`, fill in `src/core/job/layer-fill.ts:187-195`, and CNC in `src/core/cnc/collect-cnc-contours.ts:55-76`.
- Reproduction: an independently run metamorphic probe compiled a unit cubic under scale 100. It produced eight chords and a sampled machine-space deviation of `1.1717192056 mm`, about 47 times the declared `0.025 mm` tolerance.
- Corroborating implementation: SVG import already converts a world-space tolerance back through the transform using `linearScaleMagnitude` at `src/io/svg/parse-svg.ts:221-245` and `src/io/svg/transform-scale.ts:1-13`.
- Coverage gap: `src/core/job/compile-job-curves.test.ts:6-49` exercises only the identity transform.
- Impact: preview/toolpath fidelity can vary with an object's representation and scale; line, fill, and CNC consumers share the ordering defect.

### L2-02 — curve-budget exhaustion silently substitutes compatibility geometry

- State: **Confirmed design conflict — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: a canonical path needs more than 100,000 flattened segments at machine tolerance.
- Mechanism: `src/core/job/compilation-polylines.ts:12-23` returns `path.polylines` when canonical flattening reports `segment-budget-exceeded`; laser line and fill consume that result. CNC independently repeats the fallback at `src/core/cnc/collect-cnc-contours.ts:55-62`, and tab anchoring repeats it at `src/core/cnc/cnc-tab-anchors.ts:167-172`.
- Reproduction: a canonical path with 100,001 line segments ending at `(100001, 0)` and a deliberately divergent compatibility path ending at `(0, 1)` returned `{ kind: 'segment-budget-exceeded', segmentBudget: 100000 }`; the production branch therefore selects the `(0, 1)` geometry.
- Reachability: project validation permits up to 250,000 curve segments (`src/io/project/project-scene-integrity-validator.ts:3-13,61-77`) and validates polylines and curves independently without a parity invariant (`src/io/project/project-shape-validator.ts:384-396`).
- Contract conflict: ADR-159 (`DECISIONS.md:7524-7534`) makes curves canonical, forbids consumers from silently choosing conflicting copies, and says budget exhaustion refuses rather than emitting partial geometry. ADR-241 (`DECISIONS.md:11009-11020`) later cites the fallback as the reason any-size output can proceed, but does not state that it supersedes canonical identity or authorize silent substitution.
- Coverage gap: low-level tests only pin the flattener's error result; the compile test is under budget. The over-budget preflight fixture proves the project proceeds but does not inspect emitted geometry.
- Impact: the emitted path, CNC contour, and manual-tab reference can all come from a different or coarser representation without an integrity failure or user-visible warning.

### L2-03 — SVG viewport imports ignore `preserveAspectRatio` and default to stretching

- State: **Confirmed — source, test, and W3C algorithm agree on the mismatch**
- Severity: **P2**
- Trigger: an SVG has both a viewBox and a physical viewport whose aspect ratios differ, unless the file explicitly requests `preserveAspectRatio="none"`.
- Mechanism: `src/io/svg/svg-units.ts:31-51` computes independent physical/viewBox scales, never reads `preserveAspectRatio`, and `src/io/svg/parse-svg.ts:149-161` seeds a scale-only root transform.
- Pinned behavior: `src/io/svg/parse-svg.test.ts:97-106` expects a square `viewBox="0 0 200 200"` in a 100 mm × 50 mm viewport to become 100 mm × 50 mm.
- Normative mismatch: the W3C viewport algorithm defaults a missing attribute to `xMidYMid meet`, makes both scale factors equal, and adds alignment translation. Non-uniform stretching is reserved for the explicit `none` alignment.
- Contract drift: ADR-046 (`DECISIONS.md:2621-2645`) explicitly chose per-axis scaling and its test, so the implementation matches the local ADR but the ADR's claim of SVG import semantics is not standards-conformant.
- Impact: valid SVG artwork can be physically distorted on import. This is not a perceptual-only concern: the test asserts changed numeric geometry.

### L2-04 — SVG primitive attributes discard units, percentages, and invalid suffixes

- State: **Confirmed — verifier-discovered, source and standards verified**
- Severity: **P1**
- Trigger: a `rect`, `circle`, or `ellipse` uses an absolute unit, a percentage, or a malformed numeric suffix on a geometry attribute.
- Mechanism: `src/io/svg/shape-to-polylines.ts:52-63` parses primitive attributes with `Number.parseFloat`; rectangle and curved primitives consume those values at `:117-135` and `:186-200`.
- Concrete semantics: `width="4in"` becomes numeric `4`, `width="10%"` becomes `10`, and `width="10oops"` is accepted as `10`. ECMA-262 specifies that `parseFloat` consumes the longest numeric prefix and gives no indication that the suffix was ignored.
- Normative mismatch: W3C SVG 2 defines the relevant geometry properties as `<length-percentage>`, resolves percentages against the current viewport, and defines the absolute-unit relation `1in = 96px`.
- Coverage gap: all 12 passing cases in `src/io/svg/shape-to-polylines.test.ts:57-113` use unitless primitive attributes.
- Impact: imported primitive geometry can be physically mis-sized by a large factor or silently accept a value the SVG grammar does not permit.

## Narrowed and withheld candidates

- **Non-zero viewBox minima:** the importer does not apply the W3C `-min-x/-min-y` translation, but it also retains offset bounds. The verifier could not establish a downstream physical mismatch independent of later placement, so this was not counted separately.
- **Invalid or whitespace-heavy viewBox values:** `src/io/svg/svg-units.ts:63-69` has parser edge cases, including no trim before splitting and no direct negative/zero-dimension validity rule. These move to Loop 6's hostile-input/parser differential audit.
- **Canonical compatibility quality:** even synchronized compatibility polylines may be coarser than machine tolerance. That is included in L2-02 rather than double-counted.
- **General finite-value handling:** sampled transform, selection, curve, bounds, and job-origin code generally fails or falls back deterministically. No additional machine-output defect survived reproduction in this loop.

## Correctly rejected geometry candidates

- non-uniform resize of an already-rotated selection, which would require a shear outside the stored transform model;
- exact job-origin translations covered by the focused tests;
- SVG arc radius correction and coincident-endpoint handling that match the W3C path rules;
- preview/estimate pauses that do not alter or refuse output.

## Limitations

- The audited branch is 209 commits behind and 36 commits ahead of local `origin/main`; findings describe the exact dirty working tree.
- No generated G-code was sent to hardware, no workpiece was measured, and no perceptual renderer comparison was performed.
- The focused suite has no transformed-tolerance or over-budget compile fixture; those gaps are part of the findings, not evidence of absence.
- No source fix was implemented.

## Loop decision

Loop 2 closes with four canonical findings. The first two P1 findings were independently discovered by both auditors and retained after ADR-159/ADR-241 challenge; both SVG findings have direct current-source-versus-W3C contradictions. Loop 3 starts the semantic laser/G-code audit.

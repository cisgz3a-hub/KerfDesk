# September 5 feature audit remediation

Audited baseline: `ccaa3064d9efe904821307f0603ce842d903b586` (website v0.1.1962).
Scope: the 31 confirmed code findings from the 27-feature website/code audit.
This is remediation of those findings, not a claim that every feature is optimal or that physical
machining has been qualified. No hardware operation or manual deployment is part of this work.

The integration owner is `codex/feature-quality-controller-20260905`. Geometry/text, images,
and settings/calibration use separate branches based on the audited commit. Surfacing overlaps
the independently owned PR #728 and is being verified against the same acceptance requirements. The original
`claude/vcarve-stamp-subcell` checkout and its inherited edits remain preserved.
The authoritative integration status is the September 5 section of `docs/remediation-ledger.md`.

| Finding | Corrected behavior | Evidence lane |
|---|---|---|
| F04-01 | Flip acts in the requested world axis for rotated/nonuniform objects | geometry.md |
| F04-02 | Break Apart retains operation settings and repairs groups/run order/dependencies | geometry.md |
| F05-01 | Dogbone retains operation membership, depth, regions and overrides | geometry.md |
| F06-01 | Retired text requests cannot insert late results | geometry.md |
| F06-02 | Text edits retain object output metadata | geometry.md |
| F07-01 | Make Unique retains each object's effective overrides | geometry.md |
| F08-01 | Density unit switches preserve the canonical raster value | settings.md |
| F08-02 | Grayscale draft power values stay synchronized | settings.md |
| F09-01 | Wizard steps patch only the fields they own | settings.md |
| F09-02 | Unchecked air-assist explicitly saves false | settings.md |
| F11-01 | Crop reads paged luminance and makes cropped pixels authoritative | images.md |
| F12-01 | Undo/Redo permit Apply of the resulting image revision | images.md |
| F12-02 | Eraser uses the selected background color | images.md |
| F12-03 | Image Studio Apply replaces old paged authority while undo retains it | images.md |
| F12-04 | PNG and luminance encode one immutable pixel snapshot | images.md |
| F13-01 | Enter preserves the focused adjustment button's action | images.md |
| F13-02 | Single-layer preview uses visibility/opacity compositing | images.md |
| F14-01 | Design Studio chamfer retains carve-layer and construction identity | geometry.md |
| F14-02 | Applying an empty owned design removes its prior output | geometry.md |
| F14-03 | Restore retains unapplied design state | geometry.md |
| F15-01 | CNC fit coupons require a finite positive relief diameter | settings.md |
| F16-01 | Blank/invalid calibration fields cannot replace the scene | settings.md |
| F17-01 | Jig construction validates the combined allocation and incomplete drafts | controller.md |
| F18-01 | Camera alignment commits only to its initiating request/document/source | settings.md |
| F22-1 | Surfacing uses cancellable batched preparation and streaming output | surfacing.md |
| F22-2 | Full-page CNC preview owns modal focus and suppresses background shortcuts | controller.md |
| F23-1 | Travel visibility is applied when the Inspector scene becomes ready | controller.md |
| F24-1 | Canvas points use the machine-position jog path and its CNC retract | controller.md |
| F24-2 | Retired origin transactions cannot publish into another controller session | controller.md |
| F25-1 | Variable advancement observes its exact stream before transmission starts | controller.md |
| F26-1 | Clipboard rejection/unavailability offers a manual transcript | controller.md |

Each lane records its regression checks and limitations. Full CI and Chrome smoke must pass on the
PR revisions; the final integrated main revision is checked separately. Existing unrelated open PRs
are outside this scope. Frame remains the sole ordinary Start gate, and Job Review policy findings
remain warnings.

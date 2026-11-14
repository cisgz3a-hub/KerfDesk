# T38 Warp — refuter report
Tree: origin/main @ 975631408 (`C:\Users\stolk\kd-t1\t36-main`). Command id: `tools.warp`.

Method: my own Vitest file `C:\Users\stolk\kd-t1\zz-t38r\r38.test.ts` with my own scenes, and my own G-code reader `zz-t38r\gc.ts`. I did not reuse the auditor's `decode.ts` or `t38-warp.test.ts`. The script drives the real store and tool: `startWarpDeformTool` → `useWarpDeformSession.setHandles` → `applyWarpDeformTool`. It also uses the real `selectAllObjects`, `unlockAllObjects` and `setRegistrationOutput`, and builds the jig through the real jig editor (`createJigEditorSession` → `replaceJigLayout` → `centerJigArtwork` → `commitJigEditorSession`). Output goes through the real `prepareOutput` / `prepareOutputSnapshot` → `emitPreparedGcode`. Log: `zz-t38r\r38.log`. All 7 of my tests pass. I also reran the in-tree `warp-deform-variable-barcode.test.ts` (3/3 pass). Everything ran with `--maxWorkers=1` at 1.8 to 2.1 GB free.

## Verdicts

| Claim | Auditor | Verdict | Grade |
|---|---|---|---|
| T38-P2-1 Select All → Warp dissolves the registration jig | P2 | **REFUTED in the normal flow; reproduced only after Unlock All.** The jig editor's Save locks the outlines, so Select All skips them. The jig then survives Warp: boxes 2 → 2, jig runs 4 → 4, per-piece order unchanged. The auditor's result (boxes 2 → 0, runs 4 → 0, per-operation order) needs a deliberate Unlock All first. Warp has no jig guard (it does not use `geometryToolSources`), unlike Convert to Path, which skips unlocked outlines with a notice. | **P2 → P3** |
| T38-P2-2 Warp freezes a variable barcode | P2 | **Behaviour CONFIRMED; RE-GRADED.** ADR-350 Amd 2 decides that Warp/Deform bends a variable barcode at the shown value, "in line with ADR-386 Amendment 2's acceptance for Convert to Path". It lists notices only for skipped text. Convert to Path's identical stored-code freeze is ledgered as T26-P3-2, a decision row. What is left is the notice wording. Variable text is not frozen: it is left alone and keeps varying. | **P2 → P3 (decision row)** |
| T38-P3-1 crossed/concave handles apply silently | P3 | **Largely by design.** ADR-498 item 3 says "Handles that cross over are still applied … The user sees the preview, so nothing is refused." Reproduced: signed area 0, no warning. The only part left is the "in perspective" tooltip on a concave (bilinear) drag. | P3 (wording only), or not a defect |
| T38-P3-2 Warp enabled on variable text alone, then refuses | P3 | **CONFIRMED** (V2: menu enabled `true`; start refuses with the Bake notice; project unchanged). | P3 |
| T38-P3-3 test gap (jig, crossed notice, barcode wording) | P3 | **CONFIRMED.** No `*warp*` source or test in `src` mentions `registration` or `isRegistrationBox`. | P3 |
| R3-P2-2 (rolling v9) placed tabs drift under Warp | fixed | **CONFIRMED FIXED.** My own 8×8 DLT homography oracle puts all 3 tab gaps within 0.000 mm. | — |

## Evidence

### T38-P2-1: jig
**Reachability.** `commitJigEditorSession` always runs `lockOutlines` (`jig-editor-session.ts`, ADR-606 / WORKFLOW line 3528: "Outlines lock on the main canvas"). `selectAllObjects` skips locked objects.

**J1: real jig, normal flow, Select All → Warp.** The setup is two 60 × 50 outlines, sources C1 and C2 (ellipses on `art`, F2222) and SQ (rectangle on `eng`, F1111), with their copies in box B. The output is Artwork only. I dragged the top-right handle (+5, −3).
- Select All picked 6 of 8 objects. The boxes were not in the selection.
- Warp is enabled; Weld is disabled for the same selection, because of its `'replace'` guard.
- Warp took all 6 art objects, with one envelope over both boxes (x 138.1..262).
- Toast: "Warped 6 objects. 6 drawn shapes were converted to paths first. Curves became fine lines within 0.05 mm."
- After Apply: **boxes 2 (both still locked), jig runs 4, and order `F1111@A > F2222@A > F1111@B > F2222@B` unchanged.** The copies keep their `registration-jig-copy:` ids, so the jig identity holds.
- Pieces: lit A 271.122 → 269.036 mm and lit B 271.122 → 285.865 mm. A and B are no longer identical after the pitch shift, because one envelope bends each slot differently.
- This is what the live preview shows. It is the same as any selection-wide transform (Scale or Rotate on Select All moves copies within or out of their slots too). Only the jig panel's Size is per-slot (`applyRegistrationJigArtworkSize`). ADR-350 Amd 1 item 2 lets tools that keep the object id (Dogbone, Trim, Offset) work on jig artwork, and Warp keeps ids. **Not a defect.**

**J3: ordinary route, box A's three pieces only → Warp.**
- Boxes 2, runs 4, order unchanged.
- A 278.853 mm against B 271.122 mm, as the user asked and the preview showed.
- Control: scaling one source 1.2× by hand gives the same kind of mismatch (A 246.761 against B 271.122). Main-canvas edits never propagate to copies (no sync in `registration-jig-artwork-actions.ts`). **Not Warp-specific.**

**J2: auditor route, Unlock All → Select All (8) → Warp.**
- **Boxes 2 → 0; both outlines became `imported-svg`.**
- **Jig runs 4 → 0; order becomes `F2222@A > F2222@B > F1111@A > F1111@B`.**
- Toast: "Warped 8 objects. 8 drawn shapes were converted to paths first…". There is no jig notice.
- This reproduces the auditor's numbers.

**Is Warp gated?** No.
- `warpDeformTargets` / `prepareWarpDeform` (`warp-deform-plan.ts:65-77`, `:130-138`) check only locked, boolean compound, variable text and `isVectorPathObject`. There is no `isRegistrationBox` check and no call to `geometryToolSources`.
- Convert to Path (`convert-to-path-mutation.ts:36-41`), Cut Shapes and Trim (ADR-498 items 1-2) all skip registration boxes.

**Grade.** The harm needs a deliberate Unlock All. The outlines are locked precisely to keep them out of edits. The jig bar disappears visibly and Undo restores the jig. This follows T28-P2-3 (re-graded P3 because it needs Unlock All) and the T33-P2-1 narrowing ("the jig variant needs Unlock All"). The T26-P2-2 P2 predates the lock observation: its boxes were built unlocked with `createRegistrationBox`. **P3.**

Suggested fix, a one-liner for the P3 sweep: skip `isRegistrationBox` in `warpDeformTargets` and `prepareWarpDeform`, and add Convert to Path's sentence "The registration jig outlines were left as they are." Do not apply the full `'replace'` guard: Warp keeps ids, so jig artwork may still bend, as ADR-350 Amd 1 allows for id-keeping tools.

### T38-P2-2: variable barcode
**B1, own scene.** A Code 128 `LOT-{{serial:3}}` (module 0.3 mm) created with value LOT-041 at serial 41, on a Line operation. Warp is a pure translation: all 4 handles moved (+10, +5).
- Before Warp, the snapshot G-code differs between serials (`252:ab374467` against `267:597d7e26`).
- After Warp, the object is `imported-svg` and the template is gone (`project still has variable data: false`).
- **The G-code is identical at serials 41, 42 and 43 (`124:1aae3ccd`).** The lit segment set equals the stored code's plain burn shifted by (10, −5 machine), exactly.
  - My barcode had no caption, because I passed an empty caption renderer. That is why its stored geometry has fewer segments than the materialized one.
  - The in-tree test (3/3 pass) decodes the QR after Warp at serial 2 as SN-0002, so Apply bakes the value the canvas shows, as ADR-350 Amd 2 says.
- `prepareOutputSnapshot` gives no warning after Warp.
- Toast: "Warped 1 object. 1 drawn shape was converted to paths first." The barcode is called a "drawn shape", and nothing says it stopped being variable.

**What ADR-350 Amd 2 says** (decision 4, Warp / Deform bullet): "variable text only. … A variable barcode is bent at the value the canvas shows, which `warp-deform-variable-barcode.test.ts` already guards, in line with ADR-386 Amendment 2's acceptance for Convert to Path. The finished notice and the start notice name skipped text."
- So the freeze is an accepted decision, and the ADR specifies the notices.
- ADR-386 Amd 2 (Consequences) accepts the same freeze for Convert to Path, which also has no barcode notice. The ledger records that as **T26-P3-2, a decision row (P3)**.
- T32-P2-1 (Prepare Stamp) was P2 because no ADR accepted the freeze there.

Under the AREAS table, the defect behind this finding is accepted, and what remains is wording: name the barcode and say it now keeps the value LOT-041 for every record. **P3, decision row with T26-P3-2.** The maintainer may still choose to add the notice, or to switch Warp to the `variable` guard.

**Variable text (checked, not frozen).**
- V1: variable text `No.{{serial:3}}` with a rectangle → Warp. Only the rectangle is in the session, and the text is the same object reference.
  - Text burn before: serial 7 `176:d17faa31`, serial 8 `238:f43ae36b`.
  - After: the same two fingerprints, so the text still varies.
  - Toast: "… Variable text was left as text: use Bake Variable Text first to fix its value."
- V2: text alone. The menu is enabled, but Start refuses with that notice and the project is unchanged (this is P3-2).
- V3: the same pair grouped. Only R is warped, and the text is untouched.
- The auditor's statement "only the barcode is affected" holds.

### P3 spot checks
- **X1 (P3-1).** Swapping the TR and BR handles on a 100 × 50 rectangle applies. The result has 5 points and signed area 0.000, and the toast has no warning.
  - ADR-498 item 3 explicitly accepts this ("The user sees the preview, so nothing is refused").
  - What is left is that the tooltip (`warp-deform-commands.ts:15`) and the help (`warp-deform-command-help.ts:9`) say "in perspective" while a concave drag is bilinear. That is wording, P3 at most.
- **K1 (R3-P2-2).** A drawn 80 × 40 rectangle with 3 placed laser tabs (pathT 0.1, 0.45, 0.8) gets a perspective warp: BR (+30, +12), BL (−6, +4).
  - My own DLT homography of the pre-warp tab-gap centres: (72.080, 350), (148.436, 318.045), (53.969, 305.313).
  - Decoded gaps after Warp: (72.08, 350), (148.435, 318.045), (53.968, 305.313).
  - **Error 0.000 mm on all three. Fixed.**

## Extra findings
None raised. Checked and not raised:
- Warp of jig art across slots (J1) and of one slot (J3): the preview shows the result and it matches the general transform behaviour.
- A race: Apply bakes `latestReady` if the serial was advanced and the new value's encoding has not landed yet (READ, `variable-barcode-display.ts:85`). The window is milliseconds, the canvas shows that same value, and I did not reproduce it.

## Totals
Verdicts: T38-P2-1 RE-GRADED P2 → P3 (normal flow refuted: locked outlines keep the jig, with boxes 2, runs 4 and order intact; the dissolution needs Unlock All; no box guard in Warp); T38-P2-2 behaviour CONFIRMED, RE-GRADED P2 → P3 (ADR-350 Amd 2 accepts the bend; decision row with T26-P3-2; notice wording only; variable text is not frozen); T38-P3-1 by design per ADR-498 item 3 except the "in perspective" wording (P3 at most); T38-P3-2 CONFIRMED P3; T38-P3-3 CONFIRMED P3; R3-P2-2 tabs CONFIRMED FIXED (0.000 mm). Extra raised: 0.

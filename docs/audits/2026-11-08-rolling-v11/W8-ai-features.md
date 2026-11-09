# Rolling audit v11 — W8 AI features

- **When:** 2026-11-09   **Tree:** main @ `a3965a77d` (repro tree: scratchpad `j11-main`, an export of that SHA). `origin/main` is now `9bee2c356`; `git diff a3965a77d 9bee2c356` touches none of the files below.
- **Scope:**
  - **The AI features in the tree.** A search of `src/`, `electron/`, `services/` and `website/` found one AI feature: the optional desktop **AI design and material assistant**. It uses the operator's own OpenAI key.
  - **What is not AI.** There is still no image generation, background removal or AI upscaling. The `auto-upscale`, `region-enhance` and `background-flatten` modules in `src/core/trace/` are local deterministic image code. They have no model and make no network call.
  - **Out of scope (MCP).** Two places mention an "AI assistant", but both are the MCP route: the Place Board hint (`OutlinePhotoControls.tsx:43`) and the Phone & MCP button. W2 covers that route (KNOWN, not re-raised).
  - **Assistant files:**
    - Desktop: `electron/desktop-ai.ts`, `electron/ai/**` (routes, runtime, contracts, provider, response schema, credential store, bounded JSON).
    - Renderer: `src/platform/electron/desktop-ai.ts`, `src/core/ai/assistant.ts`, `src/ui/ai/**`.
  - **Sinks:**
    - `ai-artwork.ts` → `createArtworkOperation` → `applyLayerDefaultsToFreshLayers` → `commitProjectEdit`;
    - the laser and CNC emitters, and preflight;
    - SVG export and the CNC setup document (object and operation names).
  - **Legacy native editors (status only).** Rolling v2 28 included them: `electron/artcraft-*`, `src/ui/artcraft-studio/**`.
  - **Disclosure:**
    - the in-app "Information sent" panel;
    - `website/pages/privacy.mjs`, `website/lib/ai-privacy.mjs`;
    - the review draft `docs/legal/kerfdesk-privacy-notice.md`;
    - PROJECT.md non-negotiable 8.
  - **Governing:**
    - ADR-571 (desktop AI assistant: `docs/decisions/ADR-571-retained-design-and-explicit-desktop-adapters.md:15-17`);
    - ADR-496 decision 4 and ADR-416 decision 2 (seeding new operations);
    - ADR-623 (secure-storage check);
    - ADR-588/589/590 (legacy editors).
  - **Prior audits:** rolling v2 `28-ai-features.md` (2026-10-22), `2026-10-16-remaining-image-ai.md`, and v2 `04` P3-13 / v2 `24` P3-6 (KNOWN).
- **Lenses run:**
  - **L5** (data out, key handling, injection).
  - **L6** (provider down, rate-limited, slow or garbage; cancel; Undo).
  - **L2** (OpenAI token budget, primary docs fetched 2026-11-09).
  - **L3** (renderer/desktop validator twins, privacy texts against code).
  - **L1** (ADR-571 clauses).
  - **L8** (#1346, #1355, #1369).
  - **L7**: only for the seeding test.
  - L4 only at the IPC boundary. L9 does not apply: the assistant has one entry point, Ctrl+K / Tools.
- **How it ran:**
  - No real provider was called and no real key was used. Every provider reply was a local stub.
  - Repros are in scratchpad `zz-w8/`:
    - `r1-desktop.mts`: Node, the real `withAiRoutes`, `createAiRuntime`, `createAiCredentialStore` in a temp directory with fake secure storage, and the stubbed fetch. Output in `r1-desktop.out.txt`.
    - `src/ui/zz-w8-ai.test.ts`: focused Vitest through `vitest.w8.config.mts` with the real store, `commitProjectEdit` and `emitGcode`. Output in `r2-renderer.out.json`.
    - `r3-budget.mjs`: output-size arithmetic. Output in `r3-budget.out.txt`.
  - The repo's own `ai-artwork-seeding`, `AiAssistantDialog`, `electron/ai/routes` and `credential-store` tests were run focused: 4 files, 44 tests, all pass.
  - Available memory was 2.7–2.9 GB at each launch. No browser was needed (see Not verified).
- **Counts:** 2 raised → 0 refuted (refuter pending) → P1 0 / P2 0 / P3 2 (+ 7 KNOWN still open; 2 earlier findings fixed).
- **Security:** no SECURITY finding, so no `SECURITY-DETAILS.md` was written. The checks behind this are in Verified clean. In short:
  - The key is encrypted at rest, is never returned by a route and is never logged.
  - It is not in projects, the store, the support log or the phone relay.
  - No secret is in the code.
  - The assistant has no tools and no path from its output to an action.

## Headline

The assistant's trust boundary still holds, and the rolling v2 P2 is fixed:
- **P2 fixed.** **Add reviewed design** now seeds its operation like every other insert (#1369). It goes through the store's Pro and numbering guards (#1346).
- **AI text never becomes G-code.** An AI title carrying `\nG1 X300 … S1000\nM3` and realtime bytes (`×Ä~!?`) produced zero injected lines and zero non-ASCII bytes in laser and CNC output.
- **Off-bed drafts are refused.** A 1000 × 1000 mm draft on a 400 mm bed is refused at output (`out-of-bed`).
- **Failures are truthful and leak nothing.** Each failure gives a fixed message that does not carry the key.

The two new items are P3:
- **W8-P3-1.** The output-token cap (8192) counts reasoning tokens, yet the instructions invite up to 20,000 points. A schema-valid draft fills the cap at about 1,500 points, before any reasoning tokens. So detailed or reasoning-model requests come back "incomplete", and the operator has still paid for them.
- **W8-P3-2.** The full review-draft Privacy Notice does not mention the assistant or OpenAI at all.

Five rolling-v2 P3s and two KNOWN items are still open (table below). The most user-facing are:
- 28-P3-3: an unreadable saved key gives a generic error and disables Forget.
- 28-K-1 / 04-P3-13: the public privacy page still says the photo goes only with material requests.

## Status of earlier findings at `a3965a77d`

| ID | Status | Evidence |
|---|---|---|
| 28-P2-1 AI artwork skips Make Default, job-material recipe, CNC starter | **Fixed** by #1369 (`4e61c4ee3`) | `src/ui/ai/ai-artwork.ts:73-79` runs `applyLayerDefaultsToFreshLayers(..., svgStructuralDefaults(state.layerDefaults), state.cncLiveCaps, state.materialLibrary)`. `src/ui/ai/ai-artwork-seeding.test.ts` (job-material recipe, Make Default for all colours, 4040 machine starter) passes on the repro tree |
| 28-P3-1 closed legacy native editor blocks Save/New/Open/Close | **Open** (latent, opt-in `KERFDESK_ARTCRAFT_ROOT`) | `electron/artcraft-runtime.ts:269-270` still throws "Reopen the editor…"; `studio-project-bridge.ts:98-122` unchanged (no commit since 2026-10-21); double full stop at `project-decision-checkpoint.ts:23` |
| 28-P3-2 renderer sends candidate IDs over 200 chars; desktop refuses the whole request | **Open** | `src/ui/ai/ai-candidates.ts:16` still unbounded. REPRO (`r1-desktop.out.txt` §5): id length 220 → `400 {"error":"Invalid assistant request."}`, provider calls 0. The untested whitespace half also reproduces: a library entry with blank `title` and `materialName: "   "` gives `name "   "` → same 400 |
| 28-P3-3 unreadable saved key: generic error, "not configured", Forget disabled | **Open** | `electron/ai/credential-store.ts:71-72` (plain errors), `routes.ts:63-66`. REPRO §4: status → `400 {"error":"The assistant request failed. No changes were applied."}`; forget route → `200 {"configured":false…}`. `AiConnection.tsx:56` still gates Forget on `configured`; `ai-privacy.mjs:9` still says "Forget connection" for the "Forget API key" button |
| 28-P3-4 hidden invalid width disables Material requests; material sends hidden dimensions | **Open** (READ) | `AiRequestPanel.tsx:29-41` unchanged; width/height fields render only for `vector` (`AiRequestFields.tsx:63-90`); `contracts.ts:42-47` still requires dimensions for both tasks |
| 28-K-1 = 04-P3-13 photo sent with vector requests; privacy page says material only | **Open** | REPRO §1: a vector request's provider body carries `input_image: true`. `website/pages/privacy.mjs:111` and `website/lib/ai-privacy.mjs:13-14` still tie the photo to material requests; ADR-571 (`:15`) also says "for material requests". #1355 (`5077ca63a`) edited the privacy page but not these rows. The in-app panel ("any displayed photo", `AiRequestPanel.tsx:96`) is accurate |
| 28-K-2 = 24-P3-6 NN8 does not list the AI destination | **Open** | `PROJECT.md:464` names release, licensing and checkout traffic only |
| 28-K-3 = 04-P3-27 Artcraft finds PowerShell through `SystemRoot` | **Open** | `electron/artcraft-process-identity.ts:22`, `electron/artcraft-window-channel.ts:21` |
| 28-K-4 AI Apply bypasses the numbering and Pro setters (raw `setState`) | **Fixed** by #1346 (`7e7b11975`) | `src/ui/ai/use-ai-assistant.ts:102` commits through `commitProjectEdit`; the numbering guard refuses with its toast (`numbering-edit-guard.ts:23-38`); Pro guard `pro-operation-mutation.ts:45-80` |
| 2026-10-16 remaining-image-ai, AI rows (review without commit, one Undo, cancel, malformed drafts, desktop routes, encrypted storage) | **Still holds** | Focused run: `AiAssistantDialog.test.tsx`, `routes.test.ts`, `credential-store.test.ts`, `ai-artwork-seeding.test.ts`: 44/44 pass. One Undo removes both object and operation (REPRO `r2-renderer.out.json`: `laserUndoRestores: true`) |

## Findings

### W8-P3-1 — The 8192-token output cap counts reasoning tokens, but the instructions invite up to 20,000 points; detailed drafts come back "incomplete" after the operator has paid

- **Where:**
  - `electron/ai/provider.ts:39`: `max_output_tokens: 8192`.
  - `electron/ai/provider.ts:65`: the instructions say "Maximum 100 paths and 20000 points in total".
  - `electron/ai/provider.ts:70-71`: a non-`completed` status gives "The assistant response was incomplete. Try a smaller request."
  - `src/ui/ai/AiConnection.tsx:43-44`: the operator is asked for "a model that supports image input and structured responses".
- **Anchor:**
  - **Ground truth**, OpenAI reasoning guide, <https://developers.openai.com/api/docs/guides/reasoning>, fetched 2026-11-09 (live URL; the archive service could not be reached from this session, so no archive link). Verbatim from that page:
    - "you can limit the total number of tokens the model generates, including reasoning tokens".
    - At the limit, "you'll receive a response with a `status` of `incomplete`".
    - "you could incur costs for input and reasoning tokens without receiving a visible response".
    - "OpenAI recommends reserving at least 25,000 tokens for reasoning and outputs".
  - **Twin.** The desktop validator (`provider.ts:120-127`) and the renderer validator (`assistant.ts:64-72`) both accept 20,000 points. The token cap admits only a small fraction of that.
- **Scenario:**
  1. The operator configures a current image-capable model, as the panel asks.
  2. They request a detailed vector design, for example a 100 × 80 mm mandala or a traced-looking logo.
  3. A schema-valid draft costs about 5.4k output tokens at 1,000 points and about 8.1k at 1,500 points. These are estimates at 4 characters per token, and digit-heavy JSON usually tokenizes worse. A reasoning model also spends part of the same 8192 on reasoning.
  4. The response ends `incomplete`. KerfDesk says "The assistant response was incomplete. Try a smaller request." The operator has been charged for input and reasoning tokens and gets no draft.
  5. Nothing in the app explains the limit. A 20,000-point draft, which the instructions allow, would need about 108k tokens.
- **Evidence:**
  - SOURCE (above).
  - REPRO (arithmetic): `node zz-w8/r3-budget.mjs`:
    - 500 points: ~2.7k tokens;
    - 1,000 points: ~5.4k;
    - 1,500 points: ~8.1k;
    - 2,000 points: ~10.8k;
    - 20,000 points: ~108k tokens, against a cap of 8192 that includes reasoning.
  - REPRO (stub): `r1-desktop.out.txt` §2 `incomplete` → `400 "The assistant response was incomplete. Try a smaller request."`.
  - A real model's token use was not measured (no key, by instruction).
- **Severity:** P3.
  - The message is truthful and nothing reaches the canvas or the machine.
  - The cost is wasted API spend and a feature that fails on detailed requests.
  - The rolling-v2 report listed this only under Not verified.
- **Novelty:** new. Rolling v2 28 "Not verified" asked the question. No audit or open PR touches `provider.ts`.
- **Fix direction:**
  - Size the cap to the schema: about 25k, as OpenAI recommends, or a smaller point limit.
  - Make the instructions' point limit match what the cap can return.
  - When the provider reports `max_output_tokens` as the reason, say that the draft was too detailed for the token limit. Do not tell the operator to make a smaller request in general.
- **Refuter:** PENDING.

### W8-P3-2 — The full review-draft Privacy Notice omits the desktop AI assistant and OpenAI

- **Where:** `docs/legal/kerfdesk-privacy-notice.md`. The file never mentions OpenAI or the assistant (`grep -c -i openai` gives 0). In particular:
  - `:17` ("Projects stay on your computer unless you send them or approve remote sharing");
  - `:64` (§3.2, "remains local unless you send it or approve sharing described in section 3.7");
  - `:185-192` (§5, "Who else handles your information": Cloudflare, Google, Paddle, advisers);
  - `:194-202` (§6, transfers);
  - `:273` ("Other companies").
- **Anchor:**
  - **Contract.** ADR-571 (`ADR-571-…md:17`): "The privacy notice discloses request contents, encrypted key storage, ordinary provider connection information and the provider's data policy."
  - **Twin.** The published source `website/pages/privacy.mjs:108-112` and `website/lib/ai-privacy.mjs` do disclose the OpenAI destination.
- **Scenario:**
  - The owner's full commercial notice is preserved for legal review. It is listed in `website/pages/payment-legal-drafts.mjs:6` as the `/privacy/` source, and `privacy-policy-legal-check.md:5-7` once called it "the whole of https://kerfdesk.com/privacy/".
  - Anyone who finalises or publishes it from this draft drops the only disclosure that prompts, photos and recipe descriptions go to `api.openai.com`.
  - The notice would also leave OpenAI out of the list of third parties that receive user data (§5/§6).
- **Evidence:** READ.
  - `docs/legal/publishing-notes.md:25` says "The ordinary privacy generator remains the sole source for the privacy notice". So the draft is not published today, and the defect is latent.
- **Severity:** P3 (latent doc drift; the live page discloses the assistant).
- **Novelty:** new. Rolling v2 22 and 28 checked the website page only. The 2026-10-20 major-PR audit edited this draft for paid offline licensing (`2026-10-20-major-pr-feature-audit.md:243`), not for the AI assistant.
- **Fix direction:**
  - Add the assistant to the draft: §3.x for the request contents, encrypted key storage and OpenAI's data policy; §5/§6 for OpenAI as a recipient chosen by the user.
  - Carry the 28-K-1 photo correction over at the same time.
- **Refuter:** PENDING.

## Known (not raised as new)

- **The seven earlier items** listed as open in the status table.
- **W2 MCP findings.** These cover an AI client controlling the machine over MCP, including Place Board photos sent by an MCP assistant (`OutlinePhotoControls.tsx:43`). They are out of scope by instruction.

## Refuted

Candidates the auditor dropped before raising them:
- **AI title or explanation reaches G-code or a controller.** Dropped.
  - Evidence (REPRO `r2-renderer.out.json`): the title was `Done\nG1 X300 Y10 F100 S1000\nM3 S1000 ×Ä ~!?`, stored verbatim as the operation name. Laser output (15 lines) and CNC output (27 lines) contain 0 injected `G1 X300` lines, 0 injected `M3 S1000` lines, 0 non-ASCII bytes and no line naming the title.
  - Names reach only diagnostics, SVG `<title>` through `xmlText` (`export-scene-svg.ts:179`), and the CNC setup HTML through `escape` (`cnc-setup-document.ts:77`). The DXF writer names layers by colour (`dxf-writer.ts:90`).
- **A 1000 mm draft (the maximum allowed) on a smaller bed reaches a burn.** Dropped.
  - `prepareOutput` passes it, but emit preflight refuses: `out-of-bed: Line 9: X out of bed: 1000 (bed position)` on the 400 × 400 default bed (REPRO).
  - Start and Save use that preflight (NN1).
- **The AI object's `bounds` is the requested box, not the geometry extents.** Dropped as the same semantics as SVG import ("natural bounds … derived from the viewBox", `scene-object.ts:228`).
- **Prompt injection steers an action.** Dropped.
  - The request has no tools (REPRO §1: body keys `model, store, max_output_tokens, instructions, input, text`).
  - Matches must be supplied IDs on both sides (`provider.ts:141-151`, `assistant.ts:87-98`).
  - The material review has no Apply (`AiAssistantDialog.tsx:49-56`). Extra `gcode`/`settings` fields are stripped (REPRO §2).
  - The worst a steered model can do is write misleading title or reason text. That text is shown as plain React text in a review the operator asked for.
- **Renderer shows a raw `SyntaxError` for a non-JSON route reply** (REPRO §6: "Unexpected token '<'…"). Dropped as not reachable: every `/api/assistant/` answer from main is JSON (`routes.ts:60-62`).
- **A badly formatted key gets "Invalid assistant request." rather than a key-format message** (`routes.ts:47-58`). Dropped as polish. Real OpenAI keys match `^[A-Za-z0-9_-]+$`, and the input is trimmed.
- **The generate body cap of 2,000,000 bytes is exceeded by a maximal photo plus 50 multibyte descriptions.** Dropped. It needs a 1.6 M-character photo plus 50 candidates with 2,000-character CJK descriptions. It fails closed with "Assistant payload too large.".

## Verified clean

- **Data out (L5).** REPRO §1, stub fetch.
  - The only network call is `POST https://api.openai.com/v1/responses` with `redirect:'error'` and `store:false`, and no tools.
  - `input_text` is exactly `{task,prompt,widthMm,heightMm,candidates}`, plus an optional `input_image`.
  - No project, canvas, path, machine setting or toolpath is attached.
  - Status, Configure and Forget never contact the provider. Only **Request draft** sends.
  - The photo is re-encoded through a canvas to JPEG, which strips EXIF (`experiment-photo.ts:9-20`). Its 1.6 M-character cap matches the desktop check (`contracts.ts:76`).
- **Key handling (security).**
  - REPRO §1: the key is never echoed by configure, status or generate. The file on disk (`ai-assistant.v1`, mode `0o600`, temp file plus rename) does not contain the plaintext key.
  - Linux refuses the shared fallback key (`secure-storage-check.ts:16-37`).
  - Electron 44 has the async `safeStorage` API used here.
  - No `console.*` call exists in any AI file, so nothing reaches the support log's renderer-console capture (`main.ts:375`).
  - The key is never in the zustand store, project files or autosave. No remote-access or MCP tool reads the assistant routes. The routes accept only same-origin `app://app` requests with their own header (`app-route-guard.ts:7-28`).
  - No key-like secret exists in the source tree.
- **Failure paths (L6).** REPRO §2–§3; every reply was checked for the key:
  - 429: rate-limit text.
  - 500/503: "provider is unavailable. No changes were applied.".
  - 401: credentials text.
  - Network error, non-JSON body or truncated `output_text`: generic "No changes were applied." The thrown text, which contained the key, is not reflected.
  - `incomplete`: "Try a smaller request" (see W8-P3-1).
  - Refusal: "declined".
  - Out-of-box point: refused.
  - A 1.1 MB body: "payload too large".
  - A second request while one runs: "already running".
  - Cancel route: aborts the provider fetch signal, and the first request ends "cancelled or timed out".
  - Nothing reaches the canvas on any failure; Apply exists only after a validated draft.
- **Apply and Undo.**
  - One `Add reviewed AI design` Undo step removes both the object and the operation (REPRO).
  - Apply refuses when the document changed (`ai-artwork.ts:58-62`).
  - Apply checks the scene budget before committing.
- **Gating.**
  - The assistant exists only on desktop `app://` (`main.tsx:77`). The web build shows a desktop-only note.
  - No Free/Pro or licence check is added to request, Frame or Start, as ADR-571 requires. Apply passes the ordinary Pro authoring guard like any other edit.
  - Offline gives the generic failure, with nothing applied.
- **L8.**
  - #1346: Apply through `commitProjectEdit`.
  - #1369: seeding, checked by the seeding test and the REPRO.
  - #1355: website privacy. It did not touch the AI rows, so 28-K-1 stays open.
  - No other commit touched the AI paths since 2026-10-21.

## Not verified

- **Real OpenAI behaviour** (no key, by instruction):
  - real token counts per point;
  - how often reasoning models hit the 8192 cap;
  - whether 120 s (`runtime.ts:54`) is enough for a reasoning model's full output;
  - model quality.
- **The rendered dialog in a browser.** Not run: the focused dialog tests cover review, apply, cancel and rejection, and nothing new is UI-only.
- **Electron behaviour:**
  - `protocol.handle` abort propagation on renderer reload. The cancel route covers a closing dialog, but not a page that unloads before the cancel call leaves.
  - Packaged-build key storage on macOS and Linux.
- **Legacy native editors** (no native smoke). Status above is by reading.

```json
[
  {"id":"W8-P3-1","severity":"P3","area":"ai-features","file":"electron/ai/provider.ts","line":39,"anchor":"Ground truth OpenAI reasoning guide (max_output_tokens includes reasoning; reserve 25,000); Twin provider.ts:65 / assistant.ts:71 20,000-point limit","evidence":"SOURCE+REPRO","verdict":"PENDING","known":false,"summary":"max_output_tokens 8192 counts reasoning tokens but the instructions invite 20,000 points; a schema-valid draft fills the cap at ~1,500 points, so detailed or reasoning-model requests end 'incomplete' after the operator is charged"},
  {"id":"W8-P3-2","severity":"P3","area":"ai-features","file":"docs/legal/kerfdesk-privacy-notice.md","line":185,"anchor":"Contract ADR-571 (privacy notice discloses request contents, key storage, provider policy); Twin website/pages/privacy.mjs:108-112","evidence":"READ","verdict":"PENDING","known":false,"summary":"The full review-draft Privacy Notice never mentions the desktop AI assistant or OpenAI (latent: the published page is generated from privacy.mjs)"},
  {"id":"28-P2-1","severity":"P2","area":"ai-features","file":"src/ui/ai/ai-artwork.ts","line":73,"anchor":"Contract ADR-496 d4, ADR-416 d2","evidence":"REPRO","verdict":"FIXED","known":"fixed by #1369","summary":"AI artwork now seeded like other inserts"},
  {"id":"28-P3-1","severity":"P3","area":"ai-features","file":"electron/artcraft-runtime.ts","line":269,"anchor":"Contract ADR-589, ADR-550 item 1","evidence":"READ","verdict":"OPEN","known":"rolling v2 28-P3-1","summary":"Closed legacy editor blocks Save/New/Open/Close (latent)"},
  {"id":"28-P3-2","severity":"P3","area":"ai-features","file":"src/ui/ai/ai-candidates.ts","line":16,"anchor":"Twin electron/ai/contracts.ts:66","evidence":"REPRO","verdict":"OPEN","known":"rolling v2 28-P3-2","summary":"Candidate id >200 chars or blank name fails every material request with 'Invalid assistant request.'"},
  {"id":"28-P3-3","severity":"P3","area":"ai-features","file":"electron/ai/credential-store.ts","line":71,"anchor":"Contract ADR-550 item 1","evidence":"REPRO","verdict":"OPEN","known":"rolling v2 28-P3-3","summary":"Unreadable saved key: generic error, not configured, Forget disabled"},
  {"id":"28-P3-4","severity":"P3","area":"ai-features","file":"src/ui/ai/AiRequestPanel.tsx","line":29,"anchor":"Contract ADR-550 item 1","evidence":"READ","verdict":"OPEN","known":"rolling v2 28-P3-4","summary":"Hidden invalid width disables Material requests; hidden dimensions sent"},
  {"id":"28-K-1","severity":"P3","area":"ai-features","file":"website/pages/privacy.mjs","line":111,"anchor":"Contract ADR-571; privacy page","evidence":"REPRO","verdict":"OPEN","known":"04-P3-13","summary":"Photo sent with vector requests; privacy page says material only"},
  {"id":"28-K-2","severity":"P3","area":"ai-features","file":"PROJECT.md","line":464,"anchor":"Contract NN8","evidence":"READ","verdict":"OPEN","known":"24-P3-6","summary":"NN8 omits the AI destination"},
  {"id":"28-K-3","severity":"P3","area":"ai-features","file":"electron/artcraft-process-identity.ts","line":22,"anchor":"Twin windows-registry-command.ts","evidence":"READ","verdict":"OPEN","known":"04-P3-27","summary":"Artcraft PowerShell via SystemRoot"},
  {"id":"28-K-4","severity":"P3","area":"ai-features","file":"src/ui/ai/use-ai-assistant.ts","line":102,"anchor":"Twin numbering-edit-guard.ts","evidence":"READ","verdict":"FIXED","known":"fixed by #1346","summary":"AI Apply now commits through commitProjectEdit"}
]
```

## Refuter (2026-11-09)

- **Tree:** the same repro tree (`j11-main`, export of `a3965a77d`). Fresh context; the auditor's reasoning was not reused.
- **How it ran:**
  - Node with the real `withAiRoutes`, `createAiRuntime` and `createAiCredentialStore`, fake secure storage in a temp directory and a stubbed provider fetch: scratchpad `zz-w8r/r1-refuter.mts`, output `zz-w8r/r1-refuter.out.txt`. No real provider, endpoint or key was used.
  - The auditor's focused Vitest (`zz-w8/vitest.w8.config.mts`) was re-run once: 1 file, 3 tests, all pass. It rewrites `zz-w8/r2-renderer.out.json` in place; the values still match the report.
  - The OpenAI reasoning guide was fetched again by the refuter (2026-11-09).
  - Available memory was 2.2–2.3 GB at each launch.

### Verdicts

- **W8-P3-1: CONFIRMED, P3.**
  - `electron/ai/provider.ts:39` sends `max_output_tokens: 8192`. `provider.ts:65` tells the model "Maximum 100 paths and 20000 points in total". The desktop and renderer validators (`provider.ts:120-127`, `src/core/ai/assistant.ts:64-72`) both accept 20,000 points.
  - **Ground truth, re-fetched.** <https://developers.openai.com/api/docs/guides/reasoning> says the limit covers "reasoning tokens, visible output tokens". At the limit the response has a `status` of `incomplete`. It recommends "reserving at least 25,000 tokens for reasoning and outputs".
  - **The auditor's estimate is optimistic.** It assumes 4 characters per token. Digit-heavy compact JSON such as `{"x":12.35,"y":67.89},` usually splits into about a dozen tokens per point (numbers in short digit groups, plus punctuation tokens). On that basis the cap fills at roughly 600–800 points, before any reasoning tokens. This is an estimate: no tokenizer was available offline. It strengthens the finding.
  - **Extra symptom.** An `incomplete` reply with `incomplete_details.reason: "content_filter"` gets the same "Try a smaller request." advice (`provider.ts:70-71`; REPRO D). That advice is wrong for a filtered request.
  - **Severity held at P3.** The failure is truthful, nothing reaches the canvas or the machine, and the cost is wasted spend. It would rise only if a real measurement showed that ordinary requests to current reasoning models fail. That was not measured (no key, by instruction).
  - **Fix caveat.** Raising the cap toward 25k also needs the 120 s request timeout (`electron/ai/runtime.ts:54`) to be reconsidered. Otherwise a long reasoning reply ends "cancelled or timed out" after it has been charged.
- **W8-P3-2: CONFIRMED, P3 (latent).**
  - `docs/legal/kerfdesk-privacy-notice.md` has no mention of OpenAI or the desktop assistant. Its only AI wording concerns MCP clients (`:155`, `:273`). §5 (`:185-192`) and §6 (`:194-202`) list Cloudflare, Google and Paddle only.
  - **Why it is latent.**
    - The file is headed "Draft for review. Not published or in force." (`:3`).
    - It is rendered only into the local review output (`scripts/generate-site-pages.mjs:38-46`, `DRAFT_DIRECTORY` `output/payment-legal-draft`).
    - `scripts/generate-site-pages.test.mjs:56` asserts that the public privacy generator does not read it.
  - **ADR-571 is met today.** Its privacy-notice clause (`ADR-571-…md:17`) is met by the live source `website/pages/privacy.mjs:108-112` and `website/lib/ai-privacy.mjs`.
  - So this is drift between the live notice and the draft. It matters only when the draft is finalised.
  - **Adding OpenAI to §5.** OpenAI acts under the operator's own API account, so §5 ("who else handles your information") may need it framed as a recipient the user chooses, as the draft already does for MCP providers at `:273`.

### Challenges to "Verified clean" (security focus)

All of these held. None is raised.

- **Encryption at rest.**
  - The key is encrypted with Electron's async `safeStorage` API, not a hard-coded key: `electron/desktop-ai.ts:12` passes Electron's `safeStorage`, and `credential-store.ts:30` calls `encryptStringAsync`.
  - It is stored in `<userData>/ai-assistant.v1` (`credential-store.ts:19`). `userData` is `DESKTOP_DATA_PATH` (`electron/main.ts:129-131`).
  - Linux refuses the `v10` fallback key (`secure-storage-check.ts:44-65`).
  - On Windows, DPAPI means any process running as the same user can decrypt the file. That is the platform's model and needs local access, so it is not a finding.
- **Readback by the renderer.**
  - No route returns the key. `status` returns only `configured`, `secureStorage` and `model` (`runtime.ts:27`).
  - `configure` stores only `apiKey` and `model` (`routes.ts:48`). Extra `baseUrl` or `endpoint` fields are ignored (REPRO B).
  - Every route refuses another origin, a cross-site fetch, a missing header or a query string with 404 (REPRO C; `app-route-guard.ts:7-28`).
  - The renderer runs under `script-src 'self'`, so no inline or remote script can call the routes.
- **Leak channels.**
  - Main writes no crash reports: there is no `crashReporter` or net-log anywhere in `electron/`.
  - The support log redacts only licence keys (`support-log.ts:40`). It never receives the OpenAI key:
    - no AI file calls `console.*`;
    - every route error is caught at `routes.ts:28` and turned into fixed text, so `uncaughtExceptionMonitor` never sees it;
    - an error that carries the `Authorization` header is not reflected (REPRO A1).
  - **Latent hardening note, not raised.** V8's `JSON.parse` message quotes the start of its input. REPRO A2 shows a message containing the key when the decrypted text is not JSON (`credential-store.ts:72`). Today that message is swallowed, but a future `console.warn(error)` there would put the key into `kerfdesk.log`, which does not redact OpenAI keys.
  - Other channels: the assistant has no state in the store, autosave, recovery or project files (`ai-dialog-store.ts` holds only `open`). The phone and MCP code serves only `/api/remote/` (`remote-access/routes.ts:8`) and does not proxy the assistant routes.
  - No secret was found in the tree. A scan for `sk-…`, `OPENAI_API_KEY` and `sess-…` patterns returned only unrelated workflow names; the tests use `fake-*` keys.
- **Endpoint and transport.**
  - The URL is fixed (`provider.ts:28`) with `redirect:'error'`. Projects, settings and the configure body cannot change it (REPRO B: one call, to `https://api.openai.com/v1/responses`).
  - The model and key patterns refuse CR/LF, URLs, `/` and spaces (`contracts.ts:30-37`; REPRO B: 5 of 5 refused).
  - No `certificate-error` handler, `setCertificateVerifyProc`, `ignore-certificate-errors` or proxy override exists in `electron/`. Only `native-smoke-network.ts` uses `onBeforeRequest`, and only for qualification.
- **Data out and consent.**
  - Nothing is sent before **Request draft from OpenAI**. `AiRequestPanel.tsx:62-72` states the destination next to the button. Status, Configure and Forget make no provider call.
  - The photo field and its preview are shown for both tasks (`AiRequestFields.tsx:91-96`, `:172-187`). So 28-K-1 is a fault in the documents only; no hidden photo is sent.
  - The only hidden data is the material task's width and height (28-P3-4, KNOWN).
  - The photo is always re-encoded to JPEG through a canvas (`experiment-photo.ts:7-20`), so EXIF is dropped.
- **Forget or Configure during a request.** The in-flight provider call is aborted, it ends "cancelled or timed out", and a later request makes no further provider call (REPRO E: 1 call in total).
- **Prompt injection.**
  - The request carries no tools.
  - Matches must use supplied IDs, and the material review has no Apply.
  - An AI title becomes an object and operation name only. Every G-code use goes through `sanitizeGcodeCommentValue` (`src/core/gcode-comments.ts:51`). The re-run Vitest found 0 injected lines and 0 non-ASCII bytes.
  - A steered title that reaches an MCP client as an operation label is the general untrusted-label case. The MCP server instructions already mark that text as untrusted (rolling v5 J4), so it is not specific to the assistant.
- **Output safety.**
  - The draft is bounded to the requested box (at most 1000 mm) and placed at the identity transform.
  - Its operation takes only the operator's defaults (`ai-artwork.ts:167-183`); no AI setting is accepted.
  - The emit preflight refuses an off-bed draft (re-run: `out-of-bed`).
  - Start and Save go through the ordinary Job Review and power path.

### New findings

None. The `content_filter` message is folded into W8-P3-1. The `JSON.parse` note is latent hardening with no reachable leak, so it is not raised. No SECURITY finding, so no `SECURITY-DETAILS.md` was written.

### Not verified (refuter)

- Real token counts: no tokenizer was available offline, and no real model was called.
- Packaged Electron `net.fetch` behaviour behind a system proxy.
- macOS Keychain prompts on the per-status decrypt.

Refuter counts: raised 2, refuted 0, P1 0, P2 0, P3 2, known 7

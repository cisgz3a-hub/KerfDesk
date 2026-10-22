# Rolling audit v2 — AI features (AI assistant and Artcraft legacy editors)

- **When:** 2026-10-22   **Tree:** origin/main @ `902f1d0c0` (re-fetched at the end; unchanged)
- **Scope:**
  - AI assistant: `src/core/ai/assistant.ts`, `src/ui/ai/**`, `src/platform/electron/desktop-ai.ts`
    (renderer adapter, read for the flow), `electron/ai/**`, `electron/desktop-ai.ts`.
  - Artcraft legacy editors: `electron/artcraft-*`, `electron/desktop-artcraft.ts`,
    `src/ui/artcraft-studio/**`. Only non-security behaviour; report 04 covered security.
  - Sinks the AI output reaches: `src/ui/ai/ai-artwork.ts` → `core/scene/artwork-operation.ts`,
    plus the laser and CNC emitters for name interpolation.
  - Governing: ADR-571 (AI assistant), ADR-588/589/590 (Artcraft), ADR-496 (recipes that apply
    themselves), ADR-416 decision 2 (CNC defaults), PROJECT.md non-negotiable 8, and the AI
    rows of the privacy page (`website/pages/privacy.mjs:99-101`, `website/lib/ai-privacy.mjs`).
  - Prior audits: `docs/audits/2026-10-16-remaining-image-ai.md`, `2026-10-15-tools-create-calibrate.md`.
  - There is no image-generation feature in the tree. The assistant returns only polylines
    (vector task) or IDs of saved recipes (material task).
- **Lenses run:** L1, L2, L3, L4, L5, L6 and L7.
  - L2 used primary OpenAI docs: structured outputs, image inputs and API data handling, plus the
    PhotoCraft 0.7.0 control protocol.
  - No live provider call was made and no real key was used. Every provider reply was mocked.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+ 4 KNOWN). Refuter: 5 CONFIRMED,
  0 PLAUSIBLE, 0 REFUTED; no severity changes. Several P3 line citations were corrected (see
  each verdict).

## Headline

The AI trust boundary holds. AI output cannot reach the controller or G-code:
- Material suggestions can only name supplied recipe IDs, and nothing applies them.
- Generated points are range-checked on both sides of the IPC.
- Extra fields such as `settings` or `gcode` are stripped.
- Titles, even ones carrying `\nG1 … S1000`, are never written into a laser or CNC program.
- The key is kept with OS encryption and is never returned or logged.

The real defect is the opposite direction. **Add reviewed design** creates its operation outside
the path every other insert takes. The AI artwork therefore ignores the operator's Make Default,
the job material's auto-applied recipe (ADR-496) and, on CNC, the machine-starter and stock feeds
(ADR-416). Repro: a new drawn shape gets 90 % / 400 mm/min / 2 passes linked to the cut recipe,
while the AI artwork gets 30 % / 1500 mm/min / 1 pass. On a Neotronics 4040 it gets the generic
1000 mm/min feed instead of the 300 mm/min starter. The rest are P3:
- Artcraft lifecycle (latent, opt-in).
- A renderer/desktop validation twin.
- Two "user told the truth" gaps in the dialog.

## Findings

### P2-1 — AI artwork skips Make Default, ADR-496 job-material recipes and CNC starter seeding

- **Where:**
  - `src/ui/ai/ai-artwork.ts:54-58`. `applyAiDraft` calls
    `createArtworkOperation(..., { mode: 'line' })` and `addLayer`, and commits the bare
    `createLayer` defaults.
  - Called from `src/ui/ai/use-ai-assistant.ts:102`.
  - Twin path every other insert takes: `applyLayerDefaultsToFreshLayers` in
    `src/ui/state/object-insert-actions.ts:283-319`. It applies `defaultSettingsForOperation`, then
    `seedFreshCncLayer` or `seedFreshLaserLayer`. It is used by import, text, draw shape, box
    panels, Design Studio and barcodes.
  - Same pattern for dimensioned vectors: `src/ui/state/prepare-dimensioned-vector.ts:32-40`.
- **Anchor:**
  - **Contract.** ADR-496 decision 4 (`docs/decisions/ADR-496-…md:39`): "Every new laser
    operation takes it, as it is created".
  - **Contract.** ADR-416 decision 2 (`ADR-416-…md:41-43`): "New CNC operations take their bit,
    feeds and depth from the CNC setup: Startup Setup, the stock material and the machine
    starter."
  - **Twin.** `src/ui/state/layer-default-actions.ts:119`: "Every path that creates or resets an
    operation looks its defaults up here". The AI path never calls it.
  - ADR-571 forbids *AI-generated* settings. It does not ask for the operator's own defaults to be
    skipped.
- **Scenario:**
  1. Laser case. The job material is "Birch plywood 3 mm" with **Take the best recipe** on (the
     default once a material is picked, ADR-496 decision 2). The library has a cut recipe of
     90 % / 400 mm/min / 2 passes.
  2. The operator asks the assistant for a 20 mm outline and clicks **Add reviewed design**.
  3. The new Line operation runs at `LAYER_DEFAULTS` (`core/scene/layer.ts:137-143`): 30 % /
     1500 mm/min / 1 pass, air off, with no recipe link.
  4. A rectangle drawn a second earlier gets the recipe. The AI part does not cut through. The
     values show in the operation card, but nothing says the recipe was skipped, and every other
     way to add artwork applies it.
  5. Make Default ("for all colours") is likewise ignored.
  6. CNC case (Neotronics 4040). The AI operation has no `layer.cnc`, so compile uses
     `DEFAULT_CNC_LAYER_SETTINGS` (`compile-cnc-job.ts:208`; `machine.ts:327-345`): 1000 mm/min,
     plunge 300, 1.5 mm per pass. The machine starter gives 300 / 250 / 0.75 with the `em-3175`
     bit. That is 3.3× the starter feed on a small router.
- **Evidence:** REPRO. Temporary `src/ui/ai/zz-28-ai-seeding.test.ts` (deleted; copy in the
  scratchpad at `…/scratchpad/audit28/zz-28-ai-seeding.test.ts`). Run with
  `node ../../../node_modules/vitest/vitest.mjs run src/ui/ai/zz-28-ai-seeding.test.ts --reporter=verbose`.
  - Laser with the job material: `drawn line 90 400 2 birch-3-cut` / `ai line 30 1500 1 undefined`.
  - Make Default for all colours (12 % / 600 / air on): drawn `{p:12,s:600,a:true}`, AI
    `{p:30,s:1500,a:false}` (asserted).
  - CNC 4040: `drawn cnc {"f":300,"p":250,"dpp":0.75,"d":1,"tool":"em-3175","src":"machine-starter"}`
    / `ai cnc "undefined (DEFAULT_CNC_LAYER_SETTINGS applies)"`.
  - L7: `AiAssistantDialog.test.tsx:186` only asserts `speed !== 999991`. No test pins the
    seeding.
  - Novelty: no audit mentions it. Open PR #1346 changes this call site to `commitProjectEdit`
    (Pro guard) but does not seed the operation.
- **Refuter:** CONFIRMED, P2 kept. Own repro through the real dialog (mocked platform
  `aiAssistant`, request, then click **Add reviewed design**), with a drawn rectangle as the twin:
  - Laser with the job material and a cut recipe of 85 % / 350 / 3: drawn
    `{p:85,s:350,n:3,link:birch-cut}`, AI `{p:30,s:1500,n:1}` with no link.
  - Make Default set through the real `makeLayerDefaultForAll` (12 % / 600 / air): drawn
    `{12,600,air}`, AI `{30,1500,no air}`.
  - Neotronics 4040 CNC: drawn `{f:300,plunge:250,dpp:0.75,em-3175,machine-starter}`, AI has no
    `cnc` block.
  - No store subscriber or later pass seeds the AI operation. `projectWithFresh*` runs only in
    import, and #1346's `commitProjectEdit` does not seed.

  Mitigations found, which do not lower the severity:
  - The values are visible and editable before Start. The AI operation is a normal card, and Job
    Review shows editable power, speed and passes. Only the drawn twin shows the preset chip
    (`JobReviewOperations.tsx:222`).
  - The CNC half is not silent. `detectMachineJobWarnings` gives Start/Save the warning "Layer
    operation-ai-… uses the generic starter feeds (1000 mm/min, 1.5 mm/pass)"
    (`cnc-default-feed-warnings.ts:20-33`).
  - The laser half has no warning (0 job warnings name the AI operation), so the P2 rests on the
    laser case: an under-powered cut, and an ignored operator default, with no notice.
  - Reach is the opt-in desktop feature with the operator's own OpenAI key, but every use of
    **Add reviewed design** hits it.
- **Fix direction:**
  - Run the new operation through `applyLayerDefaultsToFreshLayers`, as
    `prepareDimensionedVector` does. That uses the operator's own defaults and recipes and never
    AI values, so ADR-571 still holds.
  - Add a regression test beside the ADR-496 seeding tests.

### P3-1 — Closing a legacy native editor's window blocks project Save, New/Open and app Close until the editor is reopened

- **Where:**
  - `src/ui/artcraft-studio/studio-project-bridge.ts:24-37` (binding) and `:63-71`. These
    register the save checkpoint and never unbind a session whose process has exited.
  - `:98-122`: `checkpointStudioSessions` rethrows.
  - `electron/artcraft-runtime.ts:268-270`: `capture` throws "Reopen the editor before saving its
    current document." when `process.running()` is false.
  - Consumers:
    - `src/ui/app/project-save-action.ts:46-52`: Save fails.
    - `project-decision-checkpoint.ts:17-28`: returns false.
    - `confirm-discard.ts:23-24`: New and Open are refused.
    - `desktop-close-runtime.ts:167-169`: window Close is cancelled.
    - `use-desktop-editors.ts:170-179`: the panel's own Back fails. Escape is disabled at
      `DesktopEditorsPanel.tsx:26`.
- **Anchor:**
  - **Contract.** ADR-589: "Save checkpoints live managed native documents before project
    serialization". A native editor that has already exited has nothing live to checkpoint, and
    ADR-589 lets the operator use the native titlebar controls.
  - **Contract.** ADR-550 item 1 ("Failures say why"). The toast reads
    "…current document.. The project stays open."
- **Scenario:**
  1. The operator restores a legacy document. This needs the opt-in `KERFDESK_ARTCRAFT_ROOT`, the
     pinned editors and a project with `studioDocuments`.
  2. The operator edits, presses the native editor's own close button, then presses Ctrl+S in
     KerfDesk.
  3. Save fails, and so does every retry. New and Open say "The project stays open". Closing
     KerfDesk is cancelled.
  4. The way out is to click the document again, which relaunches the editor. Nothing says so.
- **Evidence:**
  - REPRO, renderer half: `src/ui/artcraft-studio/zz-28-editor-exited.test.ts` (deleted; copy in
    the scratchpad). The capture is mocked to reject with main's message. The save checkpoint
    rejects. `checkpointBeforeProjectDecision()` returns `false` twice. Toast:
    `"Could not preserve studio edits: Reopen the editor before saving its current document.. The project stays open."`
  - READ, main half (`artcraft-runtime.ts:268-270`; `running()` at `artcraft-process.ts:91`).
  - Severity is P3 (latent). ADR-590 retired the editors from the toolbar. The panel appears only
    for legacy projects, and only with the opt-in environment variable and installed editors
    (`artcraft-installation.ts:19`).
- **Refuter:** CONFIRMED, P3 (latent). Two lines of evidence:
  - I ran the renderer repro again under a refuter name, and its assertions pass:
    `checkpointBeforeProjectDecision()` returns `false` twice.
  - Main's `capture` refuses when `process.running()` is false (`artcraft-runtime.ts:268-270`).
  - Nothing in `src/ui/artcraft-studio/**` unbinds on exit. The only call to
    `unbindStudioSession` is in `resume` (`use-desktop-editors.ts:122`).
  - The double full stop follows from the message's own "." plus the template's
    `". The project stays open."` (`project-decision-checkpoint.ts:23`).
  - Reach is gated: the panel needs `studioDocuments` (`DesignSidePanel.tsx:52`), and main needs
    `KERFDESK_ARTCRAFT_ROOT` (`desktop-artcraft.ts:48`).
- **Fix direction:**
  - When a bound session's process is gone, treat its last captured or saved document as final:
    skip it with a warning instead of throwing, or unbind it.
  - Let the panel close.
  - Remove the double full stop.

### P3-2 — The renderer sends recipe candidates the desktop then refuses (ID over 200 characters), failing every material request with "Invalid assistant request."

- **Where:**
  - `src/ui/ai/ai-candidates.ts:16`: `id: \`material:${preset.id}\``, not bounded. The `name`
    (`:17`) and `description` (`:19-22`) are sliced to the desktop limits.
  - Desktop twin: `electron/ai/contracts.ts:195`, `boundedText(candidate['id'], 200)`, which
    rejects the whole request (`:212-214`).
  - Typical long IDs come from the `.clb` importer, `src/io/lightburn/clb-import.ts:98`:
    `${slug(materialName)}-${slug(description)}-${index+1}`, with no cap. The library format
    caps no preset ID length.
- **Anchor:** **Twin.** The renderer builder versus the desktop parser. The renderer already
  clamps the other two fields to exactly these limits.
- **Scenario:**
  1. A LightBurn library entry has a long description (about 150 characters or more).
  2. Every "Suggest saved material recipes" request without a narrowing filter fails before
     reaching OpenAI, with "Invalid assistant request.".
  3. Nothing names the offending recipe. The sent-information list shows names and descriptions,
     not IDs.
  4. Whitespace-only names or descriptions also pass the renderer and fail on the desktop
     (`boundedText` requires `trim().length > 0`). That case was not reproduced.
- **Evidence:** REPRO. `electron/ai/zz-28-ai-hostile.test.ts` "candidate twin" (deleted; copy in
  the scratchpad) printed `candidate id length: 212` and
  `parseAiRequest: rejected: Invalid assistant request.`.
- **Refuter:** CONFIRMED, P3. Own repro, end to end: the renderer's `aiMaterialCandidates` builds
  the request, and the request goes through the real `withAiRoutes` and `createAiRuntime`.
  - Result: `candidate id length 213`, then `400 {"error":"Invalid assistant request."}`. The
    provider is called 0 times.
  - No length cap exists in the renderer adapter (`desktop-ai.ts`) or the material-library IO.
  - Long IDs are uncommon: LightBurn descriptions are usually short. That fits P3.
  - **Citations corrected:** the desktop check is at `electron/ai/contracts.ts:66` (validator at
    `:63-72`), and `invalid()` is at `:83-84`. The file has 85 lines.
- **Fix direction:**
  - Map long IDs to short request-local keys and map the matches back, or exclude invalid
    candidates with a visible note.
  - Share one validator between renderer and desktop.

### P3-3 — An unreadable saved key opens the dialog with "The assistant request failed", shows "not configured" and disables Forget

- **Where:**
  - `electron/ai/credential-store.ts:222-223`: `decryptStringAsync` or `JSON.parse` throws a
    plain `Error`, not an `AiFailure`.
  - `electron/ai/routes.ts:106` (status) and `:148-151` (generic text).
  - `src/ui/ai/use-ai-assistant.ts:80-82`: the error is shown and status stays `null`.
  - `src/ui/ai/AiConnection.tsx:18,56`: `configured` is false, so **Forget API key** is disabled.
  - Privacy copy: `website/lib/ai-privacy.mjs:9` says "Forget connection removes the saved
    configuration". The button is labelled "Forget API key".
- **Anchor:**
  - **Contract.** ADR-550 item 1 / L6 ("the user is told the truth").
  - **Twin.** The privacy page's Forget claim against the UI.
- **Scenario:**
  1. DPAPI or Electron's `Local State` key no longer decrypts `ai-assistant.v1`. This happens
     after a Windows password reset, a restored or copied profile, or a corrupt file.
  2. Opening the dialog, with no request made, shows "The assistant request failed. No changes
     were applied." The summary says "not configured".
  3. Forget is disabled, so the unreadable file can only be overwritten by saving a new key.
- **Evidence:** REPRO. `zz-28-ai-hostile.test.ts` "undecryptable saved key" printed
  `status route: 400 {"error":"The assistant request failed. No changes were applied."}`. The
  renderer half is READ.
- **Refuter:** CONFIRMED, P3. Own repro with the real `createAiCredentialStore` in a temporary
  directory, and secure storage whose decrypt throws after a successful write.
  - `GET status` gave `400 {"error":"The assistant request failed. No changes were applied."}`.
  - `POST forget` itself works: `200 {"configured":false,…}`. So only the UI gate is wrong:
    `AiConnection.tsx:56` checks `!configured`, and `status` stays `null`.
  - Save stays enabled, because `secure` is `secureStorage !== false` (`:19`). The described way
    out holds.
  - The privacy page says "Forget connection" (`ai-privacy.mjs:9`), but the button reads
    "Forget API key".
  - **Citations corrected:** decrypt and parse are at `electron/ai/credential-store.ts:71-72` (90
    lines). The status route is at `electron/ai/routes.ts:21`, and the generic text is at
    `:63-66` (66 lines).
- **Fix direction:**
  - Return a distinct status (`unreadable`) with "The saved key cannot be decrypted on this
    account; save it again or forget it".
  - Enable Forget when the file exists.
  - Align the privacy page's button name.

### P3-4 — An invalid vector width hides behind the Material task and disables Request with no reason; Material requests also send the hidden dimensions

- **Where:**
  - `src/ui/ai/AiRequestPanel.tsx:79-91`: `dimensionsValid` gates every task.
  - `src/ui/ai/AiRequestFields.tsx:230-257`: Width and Height render only for `vector`.
  - `:241`: `Number('')` gives 0.
  - `AiRequestPanel.tsx:82-89` sends `widthMm`/`heightMm` for material requests too.
- **Anchor:**
  - **Contract.** ADR-550 item 1 / L6. The disabled control gives no reason.
  - **Contract.** The privacy page row (`privacy.mjs:101`) and `AiSentInformation` say
    "dimensions". For a material request those are values the operator cannot see.
- **Scenario:**
  1. The operator clears Width in vector mode, then switches to "Suggest saved material recipes"
     and types a prompt.
  2. **Request draft from OpenAI** stays disabled with no visible field or message.
  3. With valid values, a material request still sends `widthMm: 100, heightMm: 100` from the
     hidden fields.
- **Evidence:** REPRO. `src/ui/ai/zz-28-dialog.test.tsx` (deleted; copy in the scratchpad) printed
  `width field visible: false`, `request disabled: true`,
  `visible text mentions width/dimension: false` and
  `material request dims sent: {"w":100,"h":100}`.
- **Refuter:** CONFIRMED, P3. Own dialog repro: clear Width, switch to Material, type a prompt.
  - Result: `width visible false`, `disabled true`, and no width or dimension text apart from the
    sent-information line.
  - The button's title is the generic "Send only the reviewed request…".
  - After restoring Width to 100, the material request sent `{w:100,h:100,task:"material"}`.
  - Caveats:
    - The desktop parser also requires valid dimensions for material requests
      (`contracts.ts:44-46`), so the fix must change both sides.
    - Sending the dimensions is disclosed ("Your prompt and dimensions" in the panel, and
      "requested dimensions" on the privacy page). That half is polish.
  - **Citations corrected:** `AiRequestPanel.tsx:29-41` (gate) and `:32-39` (request, photo at
    `:37`). In `AiRequestFields.tsx`, the vector-only fields are at `:64-89` and `Number(...)` is
    at `:74`.
- **Fix direction:**
  - Validate dimensions only for the vector task, and omit them (or send null) for material.
  - Show why Request is disabled.

## Known (not raised as new)

- **K-1 = 04-P3-13** (the photo is sent with vector requests). New location for the same symptom:
  the live privacy page (`website/pages/privacy.mjs:101`, `website/lib/ai-privacy.mjs:13-14`)
  says "for material requests … any photograph you select". The code attaches the photo to
  vector requests too (`AiRequestPanel.tsx:37`, `provider.ts:26-27`). Report 22 did not check the
  AI rows. Include the privacy page in that fix.
  - **Refuter: CONFIRMED.**
    - The live page at `https://kerfdesk.com/privacy`, fetched 2026-10-22, has both the table
      row and the assistant section. Both tie the photo to material requests only, as in the
      source.
    - A vector request with a photo, sent through the real route and runtime, reached the
      provider with `input_image`.
    - The photo field renders for both tasks (`AiRequestFields.tsx:91-96`).
    - ADR-571 also says "for material requests". The in-app panel ("any displayed photo") is
      accurate.
- K-2, K-3 and K-4 were confirmed by reading:
  - `PROJECT.md` has no mention of OpenAI.
  - `SystemRoot` is at `artcraft-process-identity.ts:22`.
  - The raw `useStore.setState` is at `use-ai-assistant.ts:102`.
- **K-2 = 24-P3-6:** non-negotiable 8 does not list the OpenAI destination.
- **K-3 = 04-P3-27:** Artcraft finds PowerShell through `SystemRoot`.
- **K-4:** this is the class of 02-P2-1 and 08 K-1. AI Apply commits with raw `useStore.setState`
  (`use-ai-assistant.ts:102`), skipping `numberingEditGuardSetter`. With Run numbering open,
  numbering Cancel silently drops the added AI artwork. Open PR #1346 routes this call site
  through `commitProjectEdit`. It does not address P2-1.

## Refuted

The refuter refuted none of the raised findings. The auditor dropped these candidates before
raising them:
- **AI text becomes G-code.**
  - Dropped: the laser emitters interpolate no object or operation names
    (`grbl-strategy.ts:284`, `grbl-fill-emission.ts:64`, `emit-raster.ts:297-304` use the layer
    id, colour and numbers only).
  - CNC labels go through `sanitizeGcodeCommentValue`.
  - The AI operation's id and colour are generated by KerfDesk (`artwork-operation.ts:54-61`),
    not by the model.
  - REPRO: a title `Done\nG1 X300 Y10 F100 S1000\nM3` survives only as display text.
- **AI material suggestion changes settings.** Dropped: matches must be supplied IDs on both
  sides (`provider.ts:141-151`, `assistant.ts:87-98`), and the review offers no Apply
  (`AiDraftReview.tsx:134`).
- **Out-of-range or absurd geometry.** Dropped: REPRO, both −0.001 and 1e9 are refused with "A
  generated point lies outside the design.". NaN and Infinity cannot reach JSON, and `within`
  also checks `Number.isFinite`.
- **Preview mirrored against the canvas.** Dropped: the preview is SVG with Y down, and the scene
  is also +Y-down (`selection-placement.ts:83`).
- **Photo carries EXIF/GPS.** Dropped: `readExperimentPhoto` re-encodes through a canvas to JPEG
  (`experiment-photo.ts:7-20`).
- **Cancel then immediate re-request gets "already running".** Dropped: the window is a few
  milliseconds. The renderer's own abort is immediate, and the next click is human-paced.
- **Orphaned editor processes after exit.** Dropped as by design: ADR-589 says "It does not
  terminate native editors". The lease file stops a second launch on the same directory.
- **A draft is discarded when the project object changes during a request.** Dropped as by
  design: ADR-571 "unchanged document ownership", pinned by `AiAssistantDialog.test.tsx:193-208`.

## Verified clean

- **Data out (L5/L1).**
  - The request body is exactly `{task, prompt, widthMm, heightMm, candidates[{id,name,description}]}`
    plus an optional `input_image` (`provider.ts:20-27`; `contracts.ts:53-61` re-builds it from
    allow-listed fields).
  - No project, canvas, file path, machine setting or toolpath is attached.
  - Endpoint fixed with `redirect: 'error'`, `store: false`, no tools.
  - The sent-information panel lists candidates. Configure and Status never contact OpenAI. Only
    **Request draft** sends.
  - The privacy page's `store:false` / "not Zero Data Retention" wording matches OpenAI's data
    page: abuse-monitoring logs up to 30 days, unchanged by `store:false`.
- **Keys (Q3).**
  - Saved with `safeStorage.encryptStringAsync` to `userData/ai-assistant.v1`. Temp file plus
    rename; mode 0o600.
  - The Linux fallback key is refused (`createSecureStorageCheck`), with no plaintext fallback.
  - The key format is regex-limited, so it cannot inject headers. It is never returned by any
    route (status returns configured, secureStorage and model).
  - The input is `type=password` and cleared after save.
  - No logging in `electron/ai/**`. Route errors are fixed strings (`routes.ts:148-151`).
  - The key is never in the zustand store.
  - The support log redacts only licence keys, but no path writes the AI key to the console.
- **Output in (Q2).**
  - Both the desktop (`provider.ts:100-151`) and the renderer (`assistant.ts:37-98`) validate
    shape, caps (100 paths, 20,000 points, 10 matches, text lengths), bounds and task rules, then
    rebuild the draft from known fields. The two validators are identical.
  - Refusal content and non-`completed` status are rejected. Exactly one `output_text` is
    required.
  - Text is rendered as React text only (no HTML or markdown).
  - Apply checks the scene budget and makes one Undo step.
- **L2 (OpenAI docs).**
  - `text.format {type:'json_schema', name, strict:true, schema}` is the Responses API form.
  - The schema uses only objects with `additionalProperties:false` and all fields required.
  - Refusal is `{"type":"refusal"}`.
  - `incomplete` with `max_output_tokens` is the documented truncation.
  - A base64 data URL and `detail:'auto'` are accepted for `input_image`, and JPEG is supported.
- **Failures (Q4), by REPRO.**
  - 429 → "OpenAI reports a quota or rate limit…".
  - 5xx → "provider is unavailable. No changes were applied.".
  - Malformed output JSON, a non-JSON body or offline (`net::ERR_INTERNET_DISCONNECTED`) →
    generic "The assistant request failed. No changes were applied.". This is true, though it
    does not say "offline".
  - Status `failed` → "incomplete…".
  - Timeout 120 s; quitting cancels (`desktop-ai.ts:23`). Cancel and unmount leave `busy` and the
    controller clean.
  - Configure and Forget abort an in-flight request.
- **Artcraft hand-off.**
  - Apply saves the native revision and compares the editor identity before and after. Late
    commits are epoch-guarded.
  - The 5 s checkpoint marks the project dirty on failure.
  - Close detaches windows before HWND destruction (`main.ts:397-399`).
  - Reach: hidden unless `KERFDESK_ARTCRAFT_ROOT` is set and the project already has
    `studioDocuments` (`DesignSidePanel.tsx:52-57`).

## Not verified

- Real OpenAI behaviour. No key was used, by instruction. Not covered:
  - Model quality.
  - Whether reasoning models exhaust `max_output_tokens: 8192`, which also counts reasoning
    tokens, before the "20,000 points" the instructions allow.
  - Whether non-background requests ever return HTTP 200 with `status: failed`.
- Electron `protocol.handle` abort propagation to `request.signal` when the renderer aborts. The
  separate cancel route covers it either way.
- Native Artcraft editors were not run (no hardware or native smoke). The following rest on code
  and the protocol doc only:
  - Whether PhotoCraft `app.save {path:'…png'}` re-points the active document. The doc is
    ambiguous; if it does, a second photo Apply would fail the identity check.
  - Behaviour of edits made in an editor left running after KerfDesk exits.
- Whether AI-generated operation names reach the phone/MCP relay summaries (area 01) as
  prompt-injection text for an MCP client.

```json
[
  {"id":"P2-1","severity":"P2","area":"ai-features","file":"src/ui/ai/ai-artwork.ts","line":54,"anchor":"Contract ADR-496 decision 4, ADR-416 decision 2; Twin object-insert-actions.ts:283 applyLayerDefaultsToFreshLayers, layer-default-actions.ts:119, prepare-dimensioned-vector.ts:32","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Add reviewed design skips Make Default, the job material's auto-applied recipe and CNC machine-starter/stock seeding: AI artwork runs 30%/1500/1 pass (drawn twin 90%/400/2 linked) and on a 4040 CNC 1000 mm/min (starter 300)"},
  {"id":"P3-1","severity":"P3","area":"ai-features","file":"src/ui/artcraft-studio/studio-project-bridge.ts","line":98,"anchor":"Contract ADR-589 (checkpoint live documents), ADR-550 item 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"After a bound legacy native editor is closed, every project Save, New/Open and app Close fails until the editor is reopened; panel cannot close; toast has a double full stop (latent, opt-in env var)"},
  {"id":"P3-2","severity":"P3","area":"ai-features","file":"src/ui/ai/ai-candidates.ts","line":16,"anchor":"Twin electron/ai/contracts.ts:66 boundedText(id,200)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Renderer sends recipe candidate IDs over 200 chars (e.g. .clb-import slugs); desktop rejects the whole material request with 'Invalid assistant request.'"},
  {"id":"P3-3","severity":"P3","area":"ai-features","file":"electron/ai/credential-store.ts","line":71,"anchor":"Contract ADR-550 item 1; Twin website/lib/ai-privacy.mjs:9 'Forget connection'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Undecryptable saved key: dialog opens with 'The assistant request failed', shows 'not configured' and disables Forget"},
  {"id":"P3-4","severity":"P3","area":"ai-features","file":"src/ui/ai/AiRequestPanel.tsx","line":29,"anchor":"Contract ADR-550 item 1; privacy.mjs:101 / AiSentInformation 'dimensions'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Invalid hidden vector width disables Material requests with no visible reason; material requests also send hidden width/height"},
  {"id":"K-1","severity":"P3","area":"ai-features","file":"website/lib/ai-privacy.mjs","line":13,"anchor":"Contract ADR-571; privacy page","evidence":"READ","verdict":"CONFIRMED","known":"04-P3-13 (new location: live privacy page)","summary":"Photo sent with vector requests; privacy page says photo only for material requests"},
  {"id":"K-2","severity":"P3","area":"ai-features","file":"PROJECT.md","line":464,"anchor":"Contract NN8","evidence":"READ","verdict":"CONFIRMED","known":"24-P3-6","summary":"NN8 does not list the AI provider destination"},
  {"id":"K-3","severity":"P3","area":"ai-features","file":"electron/artcraft-process-identity.ts","line":22,"anchor":"Twin windows-registry-command.ts","evidence":"READ","verdict":"CONFIRMED","known":"04-P3-27","summary":"Artcraft PowerShell resolved via SystemRoot"},
  {"id":"K-4","severity":"P3","area":"ai-features","file":"src/ui/ai/use-ai-assistant.ts","line":102,"anchor":"Twin numbering-edit-guard.ts:1-8, store.ts:425-433","evidence":"READ","verdict":"CONFIRMED","known":"02-P2-1 / 08 K-1 class; open PR #1346","summary":"AI Apply uses raw useStore.setState, skipping the numbering and Pro setters"}
]
```

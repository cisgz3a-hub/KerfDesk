# Rolling audit v2 — Licensing

- **When:** 2026-10-21 14:40 +0800   **Tree:** origin/main @ `70c01e11f`
  (origin/main had moved to `faf5a54f1` by the time this report was written; see
  [Since the audited tree](#since-the-audited-tree).)
- **Scope:** `services/desktop-licensing/**`, `electron/*licen*.ts`,
  `electron/project-seal-key.ts`, `electron/app-route-guard.ts`, `src/ui/licensing/**`,
  `src/io/project/project-device-seal.ts`, `scripts/browser-free-build.ts`, and every
  Pro-gate call site in `src/` and `electron/`. Governing documents: ADR-523
  (Amendments 1–6), ADR-540 (Amendments 1–5), ADR-592 and its Amendment 1, ADR-623
  (Amendments 1–2), ADR-247 Amendment 1, ADR-544, the `AGENTS.md` machine and output
  policy, and `PROJECT.md` "Users and roles".
- **Lenses run:** L1, L2, L3, L5 and L6/L7, each as an independent subagent pass. L4
  (adversarial input) was folded into the two L5 passes, one for the client and one for
  the service. Three fresh refuters checked every candidate. Nothing was skipped.
- **Counts:** 27 raised → 5 refuted → P1 0 / P2 2 / P3 19 (+ 1 KNOWN)

## Headline

No licence check sits on Frame, Start, Job Review, compile, Save G-code, streaming, job
recovery, machine control or remote Start, directly or indirectly. The cryptography
holds up on both sides:

- Ed25519 grants are verified with pinned keys and canonical encoding.
- Paddle webhooks are verified as Paddle documents.
- The admin token check is constant-time.
- No injection or committed secret was found.

The two real gaps both let Free users create new Pro work without asking for Pro:

1. **"My artwork" Insert**, including an edited `.lfart` file, writes through a raw
   `useStore.setState` and skips the ADR-592 store guard.
2. **"Tapered V-bit pair" inlay** produces V-carve passes but is classed as Free. Browser
   Free offers it, and it then fails at Preview with the Pro message.

Both matter more than the audited tree suggests. Shipped desktop 1.0.20 opens in KerfDesk
Free, and ADR-623 Amendment 3 (merged after this tree) keeps desktop Free for 1.0.21.

The refresh nonce from PR #1314 works as signed. However, the ADR-592 Amendment 1 claim
that it protects trials is wrong as written (P3-1).

## PR #1314 (refresh nonce): what it changed and how it behaves now

This section is factual. It makes no recommendation about reverting.

**What #1314 changed.** It merged as `7d2a203f1` on 2026-10-20 and implemented ADR-592
Amendment 1.

- The app sends a fresh `refreshNonce` (32 random bytes, 43 base64url characters) with
  every `/v1/activations/refresh`, in the foreground and in the background
  (`electron/licensing-grant.ts:255-262`, `electron/licensing-background-refresh.ts:70-77`).
- The service validates the nonce's form and signs it into the claims
  (`services/desktop-licensing/authority.mjs:238-253,353`). A malformed nonce gets
  `400 invalid_request`. A request without a nonce gets the old nonce-free grant.
- `verifyGrant` refuses a grant that signs any other nonce (`licensing-grant.ts:125`).
- A paid wrong-clock offset was then accepted only when the nonce echoed back.

**What #1317 changed afterwards.** It merged as `3f3f529bf` (ADR-623 Amendment 2) and
removed the paid check-in and the paid clock offset (`licensing-clock.ts:57-59,89-91`). It
kept the nonce.

**Behaviour today:**

- **Mismatched nonce.** A grant signing another request's nonce throws "Replayed
  entitlement". The status becomes `unavailable` with a message, and saved rights are
  unchanged. `refreshedAt` does not move, so the next quiet check asks the service again.
- **Paid grant with no nonce.** Accepted whatever the clock says (`grantTimeChecked` is
  false for paid). That includes the saved activation answer. ADR-623 Amendment 2 accepts
  this as equivalent to staying offline.
- **Trial or developer grant with no nonce.** Accepted within ±300 s of the local clock.
  That includes the saved `/v1/trials/start` answer, which never carries a nonce. On a
  wound-back clock it therefore stands in for a trial's check-in (P3-1).
- **Background refresh.** Applies its reply with the nonce its own request sent.
- **Not verified:** whether the production Worker has been redeployed with nonce support.
  Desktop 1.0.20 predates #1314, so no shipped desktop sends a nonce yet.

## Findings

### P2-1 — "My artwork" Insert (and `.lfart` import) creates V-carve, relief or adaptive work without asking for Pro

- **Where:**
  - `src/ui/library/personal-artwork-actions.ts:62` calls
    `useStore.setState((state) => insertPersonalArtwork(state, entry))`. That is zustand's
    raw setter. The store wraps only its internal `set` in `freeProArtworkSetter` and
    `proOperationMutationSetter` (`src/ui/state/store.ts:425-433`).
  - `src/ui/library/personal-artwork-model.ts:102-157` always creates independent copies of
    the saved operations.
  - `.lfart` import is parsed with no seal check and no admission
    (`personal-artwork-actions.ts:77-93`).
- **Anchor:**
  - Contract: ADR-540 Amendment 1 item 6 ("Creating or copying Pro work asks for Pro even
    through operation sharing, settings paste, recipes, duplication and arrays").
  - Contract: ADR-592 decision 5 ("through every store edit path except history, document
    replacement and save tracking"), and ADR-592 context item 1 (hand-edited JSON).
  - Twin: paste of the same content goes through `sceneClipboardActions` wrapped in
    `proOperationMutationSetter` (`store.ts:469`) and does ask.
- **Scenario:**
  1. In a desktop session without Pro, export any artwork from My artwork as `.lfart`.
     Without Pro means: shipped 1.0.20 or 1.0.21 desktop Free, or, on the audited tree, a
     session whose trial or licence ended while KerfDesk stayed open.
  2. Change its layer's `cnc.cutType` to `"v-carve"` and import it.
  3. Choose **Insert artwork**.
  4. A new V-carve operation bound to arbitrary artwork appears with no prompt. Desktop
     compiles it, and the next save seals it on this computer, which gives unlimited
     V-carve.
  Inserting genuine V-carve artwork saved during a trial does the same, repeatedly.
- **Evidence:** REPRO.
  - Auditor and lead repro: `scratchpad/L1-contract/free-edits.l1.test.ts -t R1`, run
    through the real `personalArtworkActions(...).insert` and the real store, with the
    edition locked. Output: `proLayersBefore: 0, proLayersAfter: 1, requestProCalls: 0,
    onError: []`. The audit lead re-ran it with the same output.
  - Refuter repro `refuter-C/c1-c2-c3.rc.test.ts`:
    - Edited `.lfart` gives `proLayersAfter ['v-carve'], requestPro []`.
    - Opening the same document as a project is refused with `["vcarve"]`.
    - Pasting the same content asks for `['vcarve']`.
- **Refuter:** CONFIRMED. The Design Library opens from the toolbar
  (`ToolStrip.tsx:98`), is not a Pro feature, and has no upstream guard. Browser Free
  cannot output the result, because the V-carve engine is stripped there.
- **Severity note for the coordinator:** this is P2 because it needs the user's own local
  action and is not remotely reachable. If METHOD's P1 "licence bypass" is read as any
  shipped bypass, it qualifies on shipped desktop Free (1.0.20).
- **Fix direction:**
  - Commit Insert through a guarded store action, as paste does.
  - Add a test or lint rule that forbids project-changing `useStore.setState` outside the
    store. The same root cause produces P3-2 and P3-3.

### P2-2 — "Tapered V-bit pair" inlay produces V-carve passes but every Pro gate treats it as Free; browser Free then fails it at Preview

- **Where:**
  - `src/ui/licensing/pro-operation-policy.ts:12` (`operationProFeature`) flags only
    `v-carve`, relief and adaptive pocket. Project admission
    (`src/ui/state/pending-pro-project.ts:42-82`) uses the same rule.
  - `src/ui/layers/CncInlayFields.tsx:35` offers "Tapered V-bit pair" with no
    `requestPro`. Choosing V-carve does ask (`CncLayerFields.tsx:141-147`).
  - `src/core/cnc/tapered-inlay-operation.ts:41` builds both halves with
    `vcarveMedialPasses`.
  - `scripts/browser-free-build.ts:25` strips `vcarveMedialPasses` from browser Free as a
    Pro entry.
  - Tapered inlay was added 2026-10-09 (`08afe91ca`), after ADR-540.
- **Anchor:**
  - Twin: the browser-Free registry against `operationProFeature` and
    `projectProFeatures`.
  - Contract: ADR-540 Amendment 1 item 2 (V-carve cannot execute in a Free bundle) and
    item 5 (a policy refusal is not relabelled as a compiler failure).
  - Contract: ADR-592 decisions 4 and 5.
- **Scenario:**
  - **Browser Free (live).** Cut type "Inlay pair" then "Tapered V-bit pair" is selectable
    and unmarked. Preview then shows "Preview unavailable: Background preparation failed:
    This tool is available in KerfDesk Pro for desktop."
  - **Desktop Free** (shipped 1.0.20 and 1.0.21, or after rights end). The same choice
    produces V-bit passes identical to a Pro V-carve of that outline, with no prompt.
  - **Unsealed shared projects.** Admission lets in a project holding a tapered inlay,
    while it keeps out the same artwork as V-carve.
- **Evidence:** REPRO.
  - `scratchpad/L3-twins/tapered-inlay-twin.test.ts`,
    `tapered-equals-vcarve.test.ts` and `tapered-inlay-browser-free.test.ts` (6/6). The
    audit lead re-ran them:
    - `operationProFeature(tapered inlay) = null`; `unadmitted(tapered inlay) = []`.
    - "inlay female passes 3 vcarve passes 3 identical JSON: true".
    - "compile threw: This tool is available in KerfDesk Pro for desktop."
  - The refuter built with the real `browserFreeBuild()`:
    `[free] tapered inlay THREW…` and `[desktop] tapered inlay ok`. It also saw the Preview
    alert in a running browser-Free UI.
- **Refuter:** CONFIRMED.
  - `browser-free-build.test.ts:100-131` treats only the straight `inlay-pair` as Free.
  - `e2e/production-bundle.spec.ts` has no inlay case.
  - No ADR classifies tapered inlay, and `website/pages/cnc-data.mjs:45-48` lists "Inlay
    pair" as Free while describing only the straight pair.
  - Whichever tier the owner chooses, one of the two builds is wrong today.
  - Severity: P2, for the same P1-reading caveat as P2-1.
- **Fix direction:**
  - If the owner rules tapered inlay is Pro, classify it as `vcarve` in
    `operationProFeature` and gate the choice with `requestPro('vcarve')`.
  - If it is Free, stop stripping the engine it needs from browser Free.
  - Either way, add the tapered case to the browser-Free tests.

### P3-1 — A nonce-free trial-start answer is accepted as a refresh's check-in; ADR-592 Amendment 1's trial guarantee is false as written

- **Where:**
  - `electron/licensing-grant.ts:125` rejects only a nonce *mismatch*.
  - `electron/licensing-grant.ts:172` rewrites `lastSeenAt` to `now`.
- **Anchor:** Contract. ADR-592 Amendment 1, "Since ADR-623 Amendment 2", first bullet:
  "only when the grant signs back the nonce its request sent".
- **Scenario:**
  1. Save the `/v1/trials/start` answer through a local TLS proxy.
  2. When the 3-day check-in falls due, set the clock to its `issuedAt` + 60 s.
  3. Let the proxy answer a refresh with the saved answer.
  4. The trial reads `ready`/`pro` again, and `lastSeenAt` is rewritten downwards.
  Repeating this keeps the trial running offline.
- **Evidence:** REPRO.
  - `scratchpad/L5-client/nonce-free-refresh.repro.test.ts` (3/3).
  - `scratchpad/refuter-A/a1-restore-vs-replay.refute.test.ts` (3/3): path 1 and path 2
    end in the identical state `ready pro checkInDueAt 1790812800 lastSeenAt 1790553660`.
    - Path 1 restores a byte copy of `commercial-licence.v1` and winds the clock back, with
      no network.
    - Path 2 replays the saved answer.
  - On a correct clock the replay gives `clock-error`.
- **Refuter:** CONFIRMED as behaviour; refuted as P2. It adds no capability beyond the
  accepted same-user record restore plus clock faking (ADR-592 "What is still accepted";
  ADR-523 Amendment 6). The ADR-592 sentence "the check-in limits how long that lasts"
  (and ADR-623 Amendment 2 line 62) also overstates the protection for trials.
- **Fix direction:** Correct the wording of ADR-592 Amendment 1 and ADR-592. Requiring a
  nonce on trial refreshes would not stop the file restore.

### P3-2 — Retained-array Regenerate adds Pro-bound copies without Pro

- **Where:** `src/ui/state/retained-array-actions.ts:46` treats `committed === false` as
  "awaiting approval". The slice is composed in `projectActions(documentSet, …)`
  (`project-actions.ts:63`, `store.ts:437`), whose setter never returns false.
- **Anchor:**
  - ADR-540 Amendment 1 item 6 ("arrays").
  - Twin: creating an array (`store.ts:481`) asks.
- **Evidence:** REPRO (`L1-contract` R2; `refuter-C/c2-c3.rc.test.ts`): `vcBound 2 → 12,
  asks 0`.
- **Refuter:** CONFIRMED. P3, because the copies repeat artwork that was already admitted.
- **Fix direction:** Pass `proOperationMutationSetter(set, get)` to
  `retainedArrayActions`.

### P3-3 — Editing a barcode bound to a Pro operation changes its outline without asking

- **Where:** `src/ui/barcode/commit-barcode.ts:67` uses a raw `useStore.setState(replaced)`.
  The binding is kept by `barcode-insert-mutation.ts:80-101`.
- **Anchor:** ADR-592 decision 5 (changing the outline of Pro-bound artwork).
- **Evidence:** REPRO (`L1-contract` R3; refuter C): `outlineChanged true, stillVcBound 1,
  asks 0`.
- **Refuter:** CONFIRMED. P3, because the outline can only become barcode modules.
- **Fix direction:** Commit through a guarded store action.

### P3-4 — A remote text edit on Pro-bound artwork reports `ok` while the store refused it

- **Where:** `src/ui/remote-control/writes.ts:64-74` builds the receipt from its own
  prepared values. The store refuses silently (`pro-operation-mutation.ts:31-34`).
- **Anchor:** Twin. `arrange.ts:155` and `design-operations.ts:78,173` return `needs_pro`.
- **Scenario:**
  - A phone or MCP client is told `changedFields ['text']` while nothing changed.
  - The desktop shows an unrequested Pro dialog. It has no machine-activity check
    (`EditionProvider.tsx:166-189`), unlike `UpdatePrompt.tsx:37`, so it can appear over
    a running job. Escape or "Not now" dismisses it, and the job keeps running.
- **Evidence:** REPRO (`L1-contract/remote.l1.test.ts`; `refuter-C/c4.rc.test.ts`).
- **Refuter:** CONFIRMED, P3.
- **Fix direction:**
  - Pre-check and return `needs_pro`, as the twins do.
  - Defer the Pro dialog while machine work is active.

### P3-5 — The offline error promises "Your saved licence keeps working offline" to trials and to devices with no licence

- **Where:** `electron/licensing-messages.ts:156` (`requestFailureMessage`) and
  `MESSAGES.unconfirmed` (via `refreshFailureMessage`), used at
  `electron/licensing-runtime.ts:218,268`.
- **Anchor:** ADR-623 Amendment 2 decision 6 (trials keep their check-in and end date);
  `licensing-messages.test.ts:86-91` intent.
- **Evidence:** REPRO (`L1-contract/messages.l1.test.ts`; `refuter-C/c5.rc.test.ts`). The
  same sentence appears for no licence (`activation-required`), an overdue trial
  (`checkin-required`) and an ended trial.
- **Refuter:** CONFIRMED, P3. Still present at `faf5a54f1`.
- **Fix direction:** Promise offline use only for paid or developer rights that are
  `ready`.

### P3-6 — `PROJECT.md` and the status chip are out of date

- **Where:**
  - `PROJECT.md:42` says "Desktop Free continues to load and output existing Pro work".
    That contradicts ADR-592 decision 4: only work sealed on this computer opens.
  - `src/ui/licensing/EditionStatusButton.tsx:13` keeps a paid "Pro · check-in needed"
    label that can never show, because `CHECK_IN_LIMIT` covers trials only
    (`licensing-clock.ts:57-59`).
- **Evidence:** READ; refuter CONFIRMED. Both are still present at `faf5a54f1`.
- **Fix direction:** Reword the PROJECT.md sentence and remove the paid branch.

### P3-7 — "Editable relief…" asks for Pro but is not labelled "(Pro)"

- **Where:** `src/ui/commands/edition-command-gate.ts:11-20` has no `tools.editable-relief`
  entry, while `src/ui/layers/artwork-creation-store.ts:10-13` gates it as `relief`.
- **Evidence:** REPRO (`refuter-C/c9.rc.test.ts`): label "Editable relief…", invoking it
  asks for `['relief']`.
- **Refuter:** CONFIRMED, P3.
- **Fix direction:** Add the command to `PRO_COMMAND_FEATURES`.

### P3-8 — Any decrypt failure of the project-seal key, including a temporary one, replaces the key for good

- **Where:**
  - `electron/project-seal-key.ts:42` guards only with `isAsyncEncryptionAvailable`.
  - `:44-53` renames an unreadable key aside and makes a new one.
  - `:76-80` treats every decrypt rejection as `'unreadable'`.
- **Anchor:**
  - Contract: ADR-592 decision 4. The only accepted key loss is "A reset Windows account".
  - Twin: `licensing-store.ts` and `secure-storage-check.ts` refuse Linux's fallback key
    and reset only on the user's choice.
  - Ground truth: Electron 44 `decryptStringAsync` rejects with "is temporarily
    unavailable", and Chromium marks every DPAPI decrypt failure and a denied Keychain as
    temporary (`electron_api_safe_storage.cc` on the 44-x-y branch;
    `dpapi_key_provider.cc`; `keychain_key_provider.mm`).
- **Scenario:**
  - A passing DPAPI failure on Windows, a macOS Keychain "Deny", or Linux without a
    keyring sets the key aside.
  - The next launch makes a fresh key.
  - Projects sealed earlier then need Pro to reopen in Free.
- **Evidence:** REPRO (`L6-L7/mut/run-repro/seal-key-rotation.test.ts`;
  `L2-ground-truth/vt/seal-key-temporary.test.ts`;
  `refuter-A/a2-seal-temporary.refute.test.ts`): `launch3 key == launch1 key: false`.
- **Refuter:** CONFIRMED, P3.
  - macOS and Linux packages are not published (`latest-macos.json` and
    `latest-linux.json` return 404).
  - The set-aside file is kept, and the outcome equals an accepted unsealed project.
  - With desktop Free back by default (ADR-623 Amendment 3), the Windows case reaches more
    users.
- **Fix direction:** Treat a temporary rejection as "no key this session" and never set the
  key aside then. Alternatively, keep trying set-aside keys when verifying a seal.

### P3-9 — A failed optional re-encryption makes a readable paid licence `unavailable` at launch (latent)

- **Where:** `electron/licensing-store.ts:168` re-saves inside `read()`, so a failed save
  fails the read and gives `unavailable`/`free` at `licensing-runtime.ts:178`.
- **Anchor:** ADR-623 Amendment 2 decision 1. Twin: the paid save is best effort in
  `licensing-paid-clock.ts:48`.
- **Evidence:** REPRO (`L6-L7/mut/run-repro/reencrypt-failure.test.ts`;
  `refuter-A/a3-a5-a6.refute.test.ts`).
- **Refuter:** mechanism CONFIRMED; not reachable on Windows. Electron 44 registers only
  the DPAPI provider there, so `shouldReEncrypt` is always false. It applies to Linux once
  that ships.
- **Fix direction:** Return the decrypted record and retry the re-save best effort.

### P3-10 — A truncated or mistyped licence key is blamed on the service

- **Where:**
  - The client forwards any 8–256 characters (`electron/licensing-store.ts:61-69`).
  - The server refuses anything outside 80–100 characters as `400 invalid_request`
    (`services/desktop-licensing/authority.mjs:55-59`).
  - The client shows that as "The licence service could not process this request. Please
    try again later" (`electron/licensing-messages.ts:17-29`).
- **Anchor:** Twin (client against server key validation).
- **Evidence:** REPRO (`L3-twins/licence-key-twin.test.ts`; refuter A).
- **Refuter:** CONFIRMED, P3. The form's own hint covers `KD1.`-prefixed text.
- **Fix direction:** Check the key's shape before sending, or map `invalid_request` on key
  routes to "key not accepted".

### P3-11 — The update cut-off date shows a different day in the licence window and the panel

- **Where:** UTC at `electron/licensing-status.ts:105-107`; local time at
  `src/ui/licensing/LicencePanel.tsx:196` and `update-status-text.ts:92-95`. Both appear
  in the same window.
- **Evidence:** REPRO (refuter A, TZ=America/Los_Angeles): "Updates through 8/20/2026" and
  "released until 2026-08-21".
- **Refuter:** CONFIRMED, P3. It cannot happen until the first update year ends.
- **Fix direction:** Render both in one zone.

### P3-12 — Regression gaps on fragile licensing paths

**Surviving mutations.** Each change below left every licensing test passing (255/255
Electron tests or 85/85 service tests) in `scratchpad/L6-L7/mut/`:

- **Paid-rights refusal.** Treating a refresh refused with `401 invalid_credentials` as a
  revocation (`electron/licensing-grant.ts`, `revokedRecord`). No test pins that
  `invalid_credentials`, `activation_not_found` or `license_not_found` keep paid rights,
  and a rotated server secret would turn every device's refresh into that 401.
- **Request timeout.** Removing the 15 s timeout (`electron/licensing-http.ts:21`).
  `licensing-boundaries.test.ts:398-414` checks `redirect` but not `signal`.
- **Re-encryption.** Removing the `shouldReEncrypt` re-save. No fake ever returns `true`.
- **Webhook boundary.** Changing the webhook tolerance from `> 5` to `>= 5`
  (`services/desktop-licensing/paddle.mjs:79`). `paddle.test.mjs:33-40` only checks that
  ±6 s is refused, never that ±5 s is accepted.

- **Anchor:** ADR-523 Amendment 1 item 6 and ADR-623 Amendment 2 decision 1. Paddle's SDK
  defaults to a 5 s tolerance (L2 pass).
- **Evidence:** REPRO (mutation runs); refuter A confirmed (a)–(c), and the audit lead read
  `paddle.test.mjs`.
- **Fix direction:** Add focused tests for each item.

### P3-13 — A renewal claim hands the current, rekeyed licence key to any active seat

- **Where:**
  - `services/desktop-licensing/payments.mjs:204-216` (`claimOrder`) returns `licenseKey`
    for renewals too.
  - `checkout.mjs:110-122`: a renewal authenticates with activation credentials alone.
  - `admin.mjs:105-116`: a rekey keeps seats unless `releaseSeats: true`.
- **Anchor:** ADR-523 Amendment 3 item 6 (the old key "stops activating at once");
  `docs/desktop-commercial-support.md:302-309`.
- **Scenario:**
  1. A key leaks and a thief activates one seat.
  2. Support rekeys with the default, which keeps seats.
  3. The thief buys a USD 20 renewal from that seat and the claim returns the new key.
- **Evidence:** REPRO (`L5-server/repro.mjs` E; `refuter-B/repro.mjs`).
- **Refuter:** CONFIRMED, P3. The runbook's `releaseSeats: true` step prevents it, but
  lookup shows only a seat count.
- **Fix direction:** Have renewal claims return no key, or make a rekey free seats bound to
  older key versions.

### P3-14 — Trial hardware binding is first-come and needs no proof of owning the hardware

- **Where:** `services/desktop-licensing/authority.mjs:128-129` lets an existing trial bind
  any unbound `hardwareId` it is sent. The digest is an unkeyed SHA-256
  (`electron/licensing-device.ts:71-73`).
- **Anchor:** ADR-592 decision 3 ("The original installation always reaches its own
  trial").
- **Scenario:** an attacker who knows a victim's firmware UUID binds its digest first. The
  victim's first-ever install then gets `trial_already_used`.
- **Evidence:** REPRO (`L5-server/repro.mjs` A: one trial held 6 bindings; refuter B).
- **Refuter:** CONFIRMED, P3. It needs the UUID, which is not normally public, and the
  README disclaims attestation.
- **Fix direction:** Bind at most one digest per trial.

### P3-15 — A duplicated OEM firmware UUID refuses an honest second PC, and nothing can clear the binding

- **Where:** `electron/licensing-device.ts:55` claims the hardware ID "can never stop an
  honest trial on its own". The placeholder list cannot be complete, and no admin route or
  runbook step touches `trial-hardware:` records (only `authority.mjs:126`).
- **Anchor:**
  - ADR-592 decision 3.
  - Ground truth: Microsoft ConfigMgr, "some specialty hardware devices have duplicate
    identifiers"
    (https://learn.microsoft.com/en-us/intune/configmgr/core/clients/manage/manage-clients).
- **Evidence:** SOURCE + READ.
- **Refuter:** CONFIRMED, P3 (rare). The app tells the user to email support, which has no
  remedy.
- **Fix direction:** Add an admin route to clear one binding, and correct the comment.

### P3-16 — Workers Logs and 1% traces are on, against ADR-523 Amendment 3, and traces keep more than the docs say

- **Where:** `services/desktop-licensing/wrangler.jsonc:10-14`, turned on by `271796e64`,
  which cites no decision.
- **Anchor:**
  - Contract: ADR-523 Amendment 3 ("Workers Logs stays off… The privacy notice must then
    say that request logs are kept and for how long").
  - `services/desktop-licensing/README.md:15`.
  - `docs/legal/privacy-policy-legal-check.md:50` still cites `enabled: false`.
  - Ground truth: Cloudflare trace spans record `user_agent.original`,
    `geo.locality.name`, `cloudflare.asn` and `url.full`
    (https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/).
    Once licence email is on, `url.full` would hold the Paddle `/customers/ctm_…` URL that
    `paddle.mjs:231` says is "never stored".
- **Evidence:** SOURCE + READ.
- **Refuter:** CONFIRMED, P3.
- **Fix direction:** Either disclose retention and the trace attributes, or turn traces off.
  Then align the ADR and the legal check.

### P3-17 — One Durable Object sits behind per-/64, per-location limits, so trial or forged-webhook floods can saturate it or fill its storage (partly KNOWN)

- **Where:**
  - `services/desktop-licensing/rate-limit.mjs:18-30` and `wrangler.jsonc:38-54` set the
    limits: trials 5 a minute, webhooks 600 a minute, per key.
  - `authority.mjs:125-146` writes 3 records per anonymous trial and never purges them.
  - `worker.mjs:48-50` sends everything to one object.
  - `http.mjs:64` reads up to 128 KiB of a webhook inside the object before checking its
    signature.
- **Anchor:**
  - Contract: ADR-523 Amendment 3 item 3.
  - Ground truth:
    - Cloudflare rate-limit bindings are "local to the" location.
    - Durable Objects have a "storage limit of 10 GB" and a "soft limit of 1,000 requests
      per second".
    - Paddle recommends allowlisting its webhook IPs.
    - RIPE-690 recommends a /56 per residential subscriber, against the code's
      one-/64-per-subscriber premise.
- **Evidence:** REPRO (`L5-server/trial-cost.mjs`: 3 records and about 0.8 KB per trial) +
  SOURCE.
- **Refuter:** PLAUSIBLE, P3. It was not run at scale, and it only causes an outage: paid
  rights work offline.
- **KNOWN part:** trial purging is already open in ADR-523 Amendment 3.
- **Fix direction:**
  - Add a coarser per-/48 or global trial ceiling.
  - Check the webhook IP or signature at the edge before forwarding.
  - Build the planned trial purge.

### P3-18 — The service README still describes the removed paid clock and nonce rule and a paid check-in deadline

- **Where:** `services/desktop-licensing/README.md:84` and `:197`, against
  `electron/licensing-clock.ts:89-91` (a paid grant is never time-checked) and ADR-623
  Amendment 2 decision 2.
- **Evidence:** READ, plus a focused test (`licensing-runtime-checkin.test.ts -t "never a
  paid one"`, which passes).
- **Refuter:** CONFIRMED, P3.
- **Fix direction:** Update both passages.

### P3-19 — Deleting a customer cancels a revocation a device has not yet received; README:21 and the runbook don't say so

- **Where:**
  - `services/desktop-licensing/admin.mjs:191` (`deleteCustomer`) deletes the licence and
    its activations.
  - A later refresh gets `401 invalid_credentials` (`authority.mjs:215-220`), which keeps
    saved rights by design (`electron/licensing-messages.ts:107-110`).
- **Anchor:** `services/desktop-licensing/README.md:21` ("devices remove their saved rights
  at the next online refresh"); runbook steps 3–4 in
  `docs/desktop-commercial-support.md:323-327`.
- **Evidence:** REPRO (`L6-L7/repro/deleted-customer-refresh.mjs`; `refuter-B/repro.mjs`):
  refresh after revoke gives `403 license_revoked`; after deletion it gives
  `401 invalid_credentials`, and rights are kept.
- **Refuter:** REFUTED as a P2 contract break, with a P3 residual.
  - The outcome is designed and disclosed: `docs/legal/kerfdesk-privacy-notice.md:240`
    says "Computers that already have it keep the Pro rights saved on them".
  - ADR-523 Amendment 1 item 6 says only explicit answers remove rights.
  - Deletion needs a verified customer request, and the gain equals the accepted
    firewall-the-service limitation.
  - What remains is that README:21 and the runbook don't tell support this.
- **Fix direction:** State this in README:21 and the runbook, or keep a data-free revoked
  marker for deleted paid seats.

### KNOWN

- **K-1:** `AGENTS.md:34` still says devices check in "paid 30 days". ADR-623 Amendment 2's
  Consequences leave this edit to the maintainer, and it is still present at `faf5a54f1`.
  Raised independently by L1, L3 and refuter C.

## Refuted

- **R-1** — IP-keyed rate limits, where a classroom behind one NAT gets 5 trial starts a
  minute (L2-5). ADR-523 Amendment 3 item 3 chose address keys deliberately. The route has
  no authenticated key, and the refusal message is truthful.
- **R-2** — Deleting a trial gives the same installation a fresh trial (L3-6). This is
  documented in ADR-523 Amendment 3, `docs/desktop-commercial-support.md:333` and README:108,
  and was kept by ADR-592 (#1173). The retained binding still refuses other installations.
- **R-3** — A temporary keychain or DPAPI failure is reported as a corrupt licence and
  steers the user to Reset (L2-2). Chromium flags every DPAPI failure as temporary, so the
  flag cannot separate this from the account-reset case the message names. ADR-613
  accepts re-entering the key, and Reset keeps the seat.
- **R-4** — No test for a seal on CRLF-converted text (L6/L7). The seal covers the exact
  text by design (ADR-592 decision 4), `project-seal.test.ts:39-49` already pins that
  changed text fails, and the app writes LF only.
- **R-5** — Desktop editors re-apply a Studio snapshot through a raw `setState`
  (`apply-studio-snapshot.ts:84`). In the L1 repro R4 the re-imported artwork landed on a
  new Free operation, so no bypass was observed. Harden it along with P2-1.
- **Severity downgrades (counted above, not as refuted):**
  - The deleted-customer P2 is now P3-19.
  - The trial nonce P2 is now P3-1.
  - The seal key at P2 "once macOS ships" is now P3-8.

## Verified clean

**The no-gate contract** (L1, `AGENTS.md`, ADR-540 item 3, ADR-623 Amendment 1).

- None of the 46 files importing `ui/licensing` is under `src/core`, `src/io/gcode`,
  `src/ui/laser`, `src/ui/machine`, `state/laser-*` or `remote-control/machine-*`.
- The licensing code makes no reload, relaunch or quit call.
- Project admission refuses before anything is written, so the document and any running
  job are untouched.
- Sheets and production rows are trusted (`project-sheet-actions.ts:99`,
  `production-manifest-actions.ts:135`). Autosave is sealed on write and trusted on read
  after `projectSealReady` and `initialLicenceStatus`.
- Once a workspace is admitted, a licence change never unmounts it.
- A reload mid-job reopens the workspace (`sessionAdmitted`), and only the current
  renderer's acknowledgement latches it.
- `proPromptOpen` holds only the Offset and Cut Shapes background commits.
- The main-process admission state stops only the camera bridge, and only on renderer
  open, crash or close.

**ADR-592 decision 5 on the guarded paths.**

- These ask for Pro: node edits, offset, weld, boolean, local and remote text edits, trace
  into a Pro layer, paste, imports, relief changes, CSV replacement and linked-relief
  refresh.
- These stay free: move, scale, operation settings, removal and reassigning artwork away
  from a Pro operation (`pro-artwork-settings-only.test.ts`; L1 R6).

**Client cryptography** (`electron/licensing-verification.ts:32-121`).

- Verification is `verify(null, …)` with an Ed25519 SPKI key. A 64-byte signature is
  required, and the base64url round trip must match.
- The key ID is looked up with `Object.hasOwn`, and the payload is decoded as fatal UTF-8.
- Claims must match the device ID, product, tier shape, a trial of at most 30 days with
  `updatesUntil === accessExpiresAt`, `maxDevices` 3, and the 43-character nonce form.
- Node/OpenSSL reject an S + L malleated signature (L2 repro `ed25519-malleability.mjs`).

**Key pinning.** Keys, `apiOrigin` and the channel come only from the packaged
`package.json` (`licensing-config.ts:85-94`). No environment variable, argument, file or
network answer can change them.

**IPC.** Every `/api/licensing/*` route requires `app://app`, the `X-KerfDesk-Licensing`
header and the same origin (`app-route-guard.ts`; `licensing-routes.ts:44`). Bodies are
capped at 2 KiB. DevTools are off in locked-down builds (`main.ts:276`).

**Project seal.**

- The sync HMAC, the WebCrypto HMAC, the autosave worker and Node `createHmac` all agree on
  ASCII, non-ASCII, astral, CRLF-in-strings and 5 MB text.
- Sealing then splitting round-trips exactly. A seal cannot be moved to other text or
  another computer, because it is an HMAC of the exact body under a per-computer random
  key.
- The key goes only to the `app://` renderer and its autosave worker.

**Clock and expiry.**

- The trial at `accessExpiresAt`, pre-epoch and huge clocks, and a far-future mark were
  all tested.
- Paid and developer rights read `ready` at any clock.
- The server, main process and renderer expire a trial at the same instant.

**Revocation.** `license_revoked` and `activation_inactive` drop rights at the next
successful contact. Outages and unknown codes keep them.

**Service authentication.** Every route has the credential it needs:

- licence key, checked by HMAC and re-read after each await
- activation token
- 256-bit claim token
- admin bearer (`ADMIN_TOKEN` or `ADMIN_TOKEN_NEXT`), compared with constant-time HMAC
  verify, with any `Origin` refused
- Paddle signature
- trial start and purchase checkout, deliberately anonymous

**Paddle webhook** (`paddle.mjs:66-94`). It signs `ts:raw` with HMAC-SHA256 over the raw
secret, accepts several `h1` values, and uses the 5 s tolerance that is Paddle's SDK
default; retries are re-signed. Event and payment IDs deduplicate. Price, quantity,
currency, tax mode, discount and total are all checked. Refund, chargeback, warning and
reversal outcomes match Paddle's documented shapes (L2 repro `adjustment-shape.mjs`).

**Races.** Every await between a read and a write is followed by a re-check inside
`transactionSync`. In repros, 10 concurrent trials on one digest gave exactly 1, and 5
concurrent checkouts with one request ID gave one order.

**Personal data, injection and secrets.**

- The log line has no body, IP or IDs; errors return codes only.
- SQL is parameterised, and the `keysWhere` prefix and field are regex-guarded.
- Record keys are built from strict identifiers.
- Paddle `ctm_` and `txn_` IDs are checked before any URL is built, with manual redirects.
- No secret is committed. The only hits are clearly fake fixtures
  (`services/desktop-licensing/test-support.mjs`,
  `scripts/commercial-release-package.test.mjs`) and a public key
  (`public/desktop-licence-keys.json`).

**Failure paths.**

- Only explicit answers remove rights.
- A failed save after a revocation stays binding for the session.
- A late background reply is discarded if an explicit action changed the rights meanwhile.
- Pending deactivation and an unreadable store always offer Retry or Reset.
- A failed key email keeps the purchase claimable.
- Webhook refusals are recorded and acknowledged.

**Test runs (all pass).** These 14 files were each run on their own:

- `electron/licensing-refresh-nonce` 8/8
- `licensing-runtime-checkin` 15/15
- `licensing-runtime-revocation` 4/4
- `licensing-boundaries` 33/33
- `licensing-runtime-persistence-clock.audit` 5/5
- `licensing-workspace-admission` 3/3
- `src/ui/licensing/project-seal` 6/6
- `pro-artwork-settings-only` 8/8
- `services/desktop-licensing/refresh-nonce` 5/5
- `paddle` 8/8
- `payments` 4/4
- `payment-adjustments` 20/20
- `credential-races` 2/2
- `worker.integration` 4/4

## Not verified

- **Installed apps.** No packaged Electron app was run: not on Windows, not with real
  safeStorage or DPAPI, Keychain or keyring, and not with `net.fetch` redirect or abort
  behaviour. No hardware was operated.
- **Live service.** Not checked: the deployed Worker (whether it is redeployed with nonce
  support), live Cloudflare rate-limit locality, Durable Object throughput, zone IP-header
  settings, and real trace contents.
- **Paddle behaviour Paddle does not document:**
  - the status given to automatic chargeback and chargeback-warning adjustments (if never
    `approved`, `payment-adjustments.mjs:67` never revokes);
  - whether a won warning sends `chargeback_warning_reverse`;
  - whether Checkout can re-localise a USD API transaction (it would then be refused after
    payment);
  - the webhook `Content-Type`.
- **Edge cases not reproduced:**
  - Whether the Pro dialog that a refused remote edit raises during a job blocks a click on
    Stop (jsdom cannot show this).
  - Antivirus or OneDrive locks on the trial clock's per-second save.
  - The MCP transport, separately from remote control.
- **ADR-540 Amendment 1 item 6 deferred-edit epoch rules** were not re-tested; the
  2026-10-02 audit covered them.

### Since the audited tree

origin/main moved from `70c01e11f` to `faf5a54f1` during this audit.

- **#1335 (ADR-623 Amendment 3)** holds the licence window off
  (`DESKTOP_LICENCE_WINDOW = false`). Commercial desktop opens in KerfDesk Free again, as
  1.0.20 did. P2-1 and P2-2 therefore reach every unlicensed desktop user. Their files are
  unchanged between `70c01e11f` and `faf5a54f1`, and refuter C found the same code in
  1.0.20's source (`dfba62ae9`).
- **#1337** holds OS file opens at launch until the first licence status.

These changes were not audited here. P3-5, P3-6 and K-1 were re-checked and are still
present at `faf5a54f1`.

```json
[
  {"id":"P2-1","severity":"P2","area":"licensing","file":"src/ui/library/personal-artwork-actions.ts","line":62,"anchor":"Contract: ADR-540 Amd 1 item 6; ADR-592 decision 5 and context 1. Twin: paste via proOperationMutationSetter (store.ts:469)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"My artwork Insert / edited .lfart import writes via raw useStore.setState, creating V-carve/relief/adaptive operations and artwork without asking for Pro"},
  {"id":"P2-2","severity":"P2","area":"licensing","file":"src/ui/licensing/pro-operation-policy.ts","line":12,"anchor":"Twin: scripts/browser-free-build.ts:25 vs operationProFeature/projectProFeatures; Contract: ADR-540 Amd 1 items 2 and 5; ADR-592 d4/d5","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tapered V-bit inlay builds V-carve medial passes but is Free to choose and passes admission; browser Free offers it then fails Preview with the Pro message"},
  {"id":"P3-1","severity":"P3","area":"licensing","file":"electron/licensing-grant.ts","line":125,"anchor":"Contract: ADR-592 Amd 1 'Since ADR-623 Amendment 2' bullet 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Nonce-free trial-start answer accepted as a refresh check-in on a wound-back clock; equals accepted file restore, but the ADR's trial guarantee is false as written"},
  {"id":"P3-2","severity":"P3","area":"licensing","file":"src/ui/state/retained-array-actions.ts","line":46,"anchor":"Contract: ADR-540 Amd 1 item 6; Twin: arraySelection","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Retained-array Regenerate adds Pro-bound copies without Pro; guard wired to an unguarded setter"},
  {"id":"P3-3","severity":"P3","area":"licensing","file":"src/ui/barcode/commit-barcode.ts","line":67,"anchor":"Contract: ADR-592 decision 5","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Barcode edit changes a Pro-bound outline via raw setState without asking"},
  {"id":"P3-4","severity":"P3","area":"licensing","file":"src/ui/remote-control/writes.ts","line":68,"anchor":"Twin: arrange.ts:155, design-operations.ts:78 needs_pro","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote text edit on Pro-bound artwork returns ok while the store refused it; Pro dialog can appear over a running job"},
  {"id":"P3-5","severity":"P3","area":"licensing","file":"electron/licensing-messages.ts","line":156,"anchor":"Contract: ADR-623 Amd 2 decision 6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Offline error promises the saved licence keeps working to trials and unlicensed devices"},
  {"id":"P3-6","severity":"P3","area":"licensing","file":"PROJECT.md","line":42,"anchor":"Contract: ADR-592 d4; ADR-623 Amd 2 d1","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"PROJECT says desktop Free loads and outputs existing Pro work; dead paid 'check-in needed' chip label (EditionStatusButton.tsx:13)"},
  {"id":"P3-7","severity":"P3","area":"licensing","file":"src/ui/commands/edition-command-gate.ts","line":11,"anchor":"Twin: artwork-creation-store.ts:10-13","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Editable relief command is Pro-gated but not labelled (Pro)"},
  {"id":"P3-8","severity":"P3","area":"licensing","file":"electron/project-seal-key.ts","line":80,"anchor":"Contract: ADR-592 d4; Twin: licensing-store/secure-storage-check; Ground truth: Electron 44 temporarily-unavailable","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Any seal-key decrypt failure, including a temporary one, sets the key aside and makes a new one, orphaning this computer's seals"},
  {"id":"P3-9","severity":"P3","area":"licensing","file":"electron/licensing-store.ts","line":168,"anchor":"Contract: ADR-623 Amd 2 d1; Twin: licensing-paid-clock.ts:48","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Failed optional re-encryption makes a readable paid licence unavailable at launch (latent: not reachable on Windows)"},
  {"id":"P3-10","severity":"P3","area":"licensing","file":"electron/licensing-store.ts","line":61,"anchor":"Twin: authority.mjs:55-59 vs validLicenceKey; licensing-messages.ts:17-29","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Truncated or mistyped key gets the 'service could not process, try later' message"},
  {"id":"P3-11","severity":"P3","area":"licensing","file":"electron/licensing-status.ts","line":105,"anchor":"Twin: LicencePanel.tsx:196, update-status-text.ts:92-95","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Update cut-off date is UTC in the window and local in the panel; days differ"},
  {"id":"P3-12","severity":"P3","area":"licensing","file":"electron/licensing-grant.ts","line":182,"anchor":"Contract: ADR-523 Amd 1 item 6; ADR-623 Amd 2 d1; Ground truth: Paddle SDK 5 s tolerance","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Mutations survive the suites: 401-keeps-paid-rights, 15 s timeout, shouldReEncrypt re-save, webhook ±5 s boundary"},
  {"id":"P3-13","severity":"P3","area":"licensing","file":"services/desktop-licensing/payments.mjs","line":215,"anchor":"Contract: ADR-523 Amd 3 item 6; desktop-commercial-support.md:302-309","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Renewal claim returns the rekeyed licence key to any active seat when a rekey keeps seats"},
  {"id":"P3-14","severity":"P3","area":"licensing","file":"services/desktop-licensing/authority.mjs","line":129,"anchor":"Contract: ADR-592 decision 3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Trial hardware binding is first-come without proof; one trial can claim any number of firmware digests"},
  {"id":"P3-15","severity":"P3","area":"licensing","file":"electron/licensing-device.ts","line":55,"anchor":"Contract: ADR-592 d3; Ground truth: Microsoft ConfigMgr duplicate identifiers","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Duplicated OEM SMBIOS UUID refuses an honest second PC; no admin route clears a hardware binding"},
  {"id":"P3-16","severity":"P3","area":"licensing","file":"services/desktop-licensing/wrangler.jsonc","line":10,"anchor":"Contract: ADR-523 Amd 3; Ground truth: Cloudflare trace span attributes","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Workers Logs and 1% traces on against ADR-523 Amd 3; retention and trace attributes undisclosed"},
  {"id":"P3-17","severity":"P3","area":"licensing","file":"services/desktop-licensing/rate-limit.mjs","line":18,"anchor":"Contract: ADR-523 Amd 3 item 3; Ground truth: Cloudflare rate-limit/DO limits, Paddle IP allowlist, RIPE-690","evidence":"REPRO","verdict":"PLAUSIBLE","known":"partial: trial purge open in ADR-523 Amd 3","summary":"Single Durable Object behind per-/64 per-location limits; trial or forged-webhook floods can saturate it or fill storage"},
  {"id":"P3-18","severity":"P3","area":"licensing","file":"services/desktop-licensing/README.md","line":197,"anchor":"Contract: ADR-623 Amd 2 d2; licensing-clock.ts:89-91","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Service README still describes the removed paid wrong-clock nonce rule and a paid check-in deadline (lines 84, 197)"},
  {"id":"P3-19","severity":"P3","area":"licensing","file":"services/desktop-licensing/README.md","line":21,"anchor":"Contract: README:21; runbook docs/desktop-commercial-support.md:323-327","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Deleting a customer cancels an undelivered revocation (refresh then gets 401, rights kept); disclosed in the privacy notice but not in README or runbook"},
  {"id":"K-1","severity":"P3","area":"licensing","file":"AGENTS.md","line":34,"anchor":"Contract: ADR-623 Amd 2 Consequences","evidence":"READ","verdict":"CONFIRMED","known":"ADR-623 Amendment 2 Consequences","summary":"AGENTS.md still says paid devices check in every 30 days"}
]
```

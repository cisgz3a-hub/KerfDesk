# Commercial Windows pilot checklist

Use this checklist for every signed commercial pilot, and again before the first
customer release. It turns the pilot section of `desktop-commercial-launch.md`
into steps with recorded evidence. Completing a run qualifies only the exact
source, installers and hosted objects it names. It does not authorize buying a
certificate, enabling payments, issuing licences or publishing to customers;
each of those needs the owner's explicit approval.

A free Preview installer never substitutes for any step here. Neither do unit
tests, local fixtures, unsigned builds or a dry run.

## Run record

Copy this block into the evidence folder for the run (outside the repository)
and fill every field. A step without evidence has not passed.

```text
Run date (UTC):
Operator:
Source SHA / tag (version N):
Source SHA / tag (version N+1):
Windows publisher name (Authenticode):
Installer N:   bytes / SHA-256
Installer N+1: bytes / SHA-256
Licensing service: environment, deployment ID, compatibility date
Download host: bucket, custom domain, both catalogue SHA-256s after each change
Test machine: Windows edition/build, x64, disposable account or VM name
Result: passed / failed at step __ (link the failing evidence)
```

## 1. Preconditions

- [ ] The Cloudflare account that owns `kerfdesk.com` is confirmed by account ID,
      zone and Pages project. It is not simply whichever account a login selected.
- [ ] The licensing Worker is deployed from `services/desktop-licensing/` with its
      secrets. Its public entitlement key equals `public/desktop-licence-keys.json`.
      `LICENSING_ENABLED` is on for the pilot environment. `PAYMENTS_ENABLED` stays
      off until section 9.
- [ ] `kerfdesk-downloads` and `dl.kerfdesk.com` are live with the CORS and cache
      contract in `desktop-preview-distribution.md`.
- [ ] A Windows code-signing certificate or signing service is available, and its
      publisher name is recorded above.
- [ ] Reviewed commercial installer terms exist as a file outside the repository.
- [ ] The legacy stable lane cannot publish the same version. Pushing `vX.Y.Z`
      also starts `release-desktop-stable.yml`; confirm `STABLE_APPROVED_RELEASE_SHA`
      does not name the commercial source (that workflow then stops before signing),
      or disable that workflow for the pilot.
- [ ] The test machine is disposable: a separate local Windows account or a VM
      snapshot. The installer is per-user and shares the application ID with
      Preview builds, so it replaces any KerfDesk installed for the same Windows
      account. Never run the pilot in an account whose KerfDesk installation,
      projects or settings are in real use.
- [ ] Each "device" in the trial and seat steps is a separate Windows
      installation. The device identity is a hash of Windows' `MachineGuid`, which
      every account on one PC shares and which cloned VMs keep unless they were
      generalized with Sysprep. A trial started in a test account on a real PC is
      that PC's trial.
- [ ] No machine is connected. Hardware qualification is separate and needs an
      explicit request.

## 2. Prepare and build versions N and N+1

For each version, from a clean checkout at the tagged source:

1. Run `scripts/prepare-commercial-desktop.mjs` with `--output-dir` and
   `--terms-file` outside the repository, the exact `--version`, `--source-sha`,
   `--source-ref refs/tags/vX.Y.Z`, a canonical UTC `--published-at` and
   `--key-id stable-2026-09`. Supply the protected stable signing key through
   `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE`; never paste it into the command.
2. Build with `pnpm build:electron-main`, `pnpm build:bundle`, then
   `electron-builder --win --x64 --config <output-dir>/electron-builder.commercial.generated.json`
   with the signing credentials loaded.
3. Record the generated `commercial-release-identity.json` next to the run
   record. A retry must reuse the same identity and timestamp.

- [ ] Both builds finished with code signing (the commercial config forces it).
- [ ] The afterPack check passed: packaged metadata, pinned keys, release identity,
      version and terms match.
- [ ] `node scripts/verify-packaged-desktop.mjs <KerfDesk.exe> <app.asar> electron-builder.yml`
      passes for each unpacked build.
- [ ] Windows shows the recorded publisher in the installer's Digital Signatures
      tab, and `Get-AuthenticodeSignature` reports `Valid`.
- [ ] Version N+1 has a later `--published-at` than version N.

## 3. Publish version N

- [ ] `node scripts/publish-commercial-release.mjs <release-dir> <identity.json> <resources-dir>`
      prints `published` for N. Only one publisher runs at a time, and never while a
      release train run is in progress.
- [ ] N is listed in `desktop/commercial/beta/catalog.json` only, and the download
      page does not show it yet (ADR-541).
- [ ] `node scripts/promote-commercial-release.mjs N` reports `promoted`, and
      `desktop/commercial/catalog.json` now lists N with the same entry as beta.
- [ ] From an ordinary browser without GitHub access, `https://kerfdesk.com/download.html`
      shows `KerfDesk N · Released <date> · Publisher signature verified.` and the
      SHA-256 printed there equals the local installer.
- [ ] The installer downloaded from that page is byte-identical to the local one.
- [ ] Both catalogues are served with `Cache-Control: no-store`; versioned objects
      are immutable. Record both catalogue SHA-256s.

## 4. Fresh install and trial

- [ ] Install N from the downloaded file in the disposable account. The
      installer shows the commercial terms, not the free License & Safety Notice.
- [ ] First launch opens the workspace as KerfDesk Free with no activation screen
      (ADR-540). The status bar shows `Free · Try Pro`; projects, camera and serial
      work without a licence.
- [ ] Open a Pro tool (Tools > Box Generator). The Pro prompt names it and offers
      the trial, Buy Pro and "I have a licence key". Not now leaves it closed.
- [ ] Start the trial from that prompt. The tool opens, the status bar shows
      `Pro trial · 30 days left`, and Help > Licence shows
      `30-day Pro trial · Ends <date>` exactly 30 days after the server registration.
- [ ] Quit and relaunch offline. Pro stays unlocked.
- [ ] Set the clock back more than five minutes before the last check: the app
      still opens, as Free, and Help > Licence reports a clock problem. Only Pro
      tools are locked. Restore the clock and relaunch.
- [ ] Uninstall and reinstall N in the same account, then start the trial again:
      the original end date is kept, not a new 30 days.

## 5. Developer licence

- [ ] Issue the `johann` developer grant through the private admin API, store the
      key privately, and activate it on the test machine. Help > Licence shows
      `Developer licence · Every Pro tool and every update`, and Show key reveals
      the same key.
- [ ] Repeating the same grant request returns the same licence; a different
      display name for the same grant ID is refused.
- [ ] The key never appears in logs, URLs, screenshots kept as evidence, or the
      run record.

## 6. Seats and transfer

- [ ] Activate the same licence on three disposable installations. A fourth is
      refused with the three-device message.
- [ ] Deactivate one installation, then the fourth activates.
- [ ] Deactivate while offline: the app shows the pending sign-out and retry.
      Reconnect and retry; the seat is freed.

## 7. Updates from N to N+1

- [ ] Publish N+1 (section 3's publish step) without promoting it. A device running
      N with "Get new versions early (beta)" ticked in Help > Licence downloads N+1;
      a device with it unticked does not.
- [ ] Untick it on the device that took N+1 early: it stays on N+1.
- [ ] Promote N+1. The stable catalogue lists both versions and the download page
      shows N+1 with N under Earlier versions.
- [ ] With a covered licence running N, the app downloads N+1 in the background.
      Nothing restarts or interrupts the open workspace.
- [ ] Quit KerfDesk normally. N+1 installs, and on relaunch Help > About shows
      N+1. Projects, recent files and settings created in N are unchanged.
- [ ] A licence whose update coverage ends before N+1's release date stays on N:
      nothing downloads, N keeps working, and N+1 installed manually opens as Free
      and reports that the release is newer than the included updates.
- [ ] A device with no licence, or whose trial ended, takes N+1 at quit and
      opens it as Free.
- [ ] Tampered or wrong-publisher installers are refused (swap the served
      installer on a private staging bucket only, never production).

## 8. Expiry

- [ ] Advance the disposable machine's clock past the trial end. The next launch
      shows the trial-ended message and asks for a licence. A session that was
      already open when the trial ended keeps working until it is closed.
- [ ] A paid licence with ended update coverage keeps admitting version N.

## 9. Payments (sandbox first, live only with explicit approval)

- [ ] With Paddle sandbox credentials and a separate sandbox database and keys,
      buy a licence from Help > Licence. The browser checkout carries only the
      `_ptxn` transaction ID.
- [ ] Before paying, close the browser, relaunch KerfDesk and reopen checkout: the
      same order resumes and no second transaction is created.
- [ ] After paying, Check payment activates the licence. Browser completion alone
      never grants it.
- [ ] Deliver the same webhook twice: one licence, one fulfilment.
- [ ] Renew updates for USD 20: the update cutoff moves by one year from the later
      of the current cutoff and today.
- [ ] Walk the support playbook (`desktop-commercial-support.md`) for a lost
      claim, an uncertain checkout and a refund, and record the operator steps.

## Exit criteria

The pilot passes only when every box above is ticked with evidence for the same
two versions. Then the owner decides separately whether to enable live checkout
and announce the licensed edition. Record the exact source, artifact and hosted
identity of whatever is released.

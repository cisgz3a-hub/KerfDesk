## ADR-578 - Easier download and licence activation (2026-10-10)

**Status:** Accepted by the owner's instruction to make downloading and inserting a licence easier
("All three, this PR": the open-KerfDesk link, emailing the key and code-signing wiring) | **Date:**
2026-10-10 | **Amends:** ADR-523 (licence delivery), ADR-562 (purchase page), ADR-561 (manual update
manifest), ADR-575 (Buy Pro)

### Context

A buyer took these steps: pay on `kerfdesk.com/buy`, copy an 84-character key, find KerfDesk's Help >
Licence, paste into a password field, then activate. Any extra text in the paste (a label, a line
break an email inserted, a zero-width character from chat) was refused as an invalid key. The
renderer may not read the clipboard (ADR-482), so there was no one-click paste. The key existed only
on that browser page; a closed tab or cleared storage meant writing to support. On the download page
the only SmartScreen steps were Preview's, and they told a buyer to stop unless the file name
contained `-preview.`, which the licensed installer never does. Preview, which cannot take a licence,
sat beside the licensed app with nothing saying so.

Two facts shape the bigger changes. electron-builder 26's NSIS target registers no URL scheme. And
every installed unsigned copy reads only `desktop/commercial-manual/latest.json`, accepting only
`codeSigning: "unsigned"`, while the signed release train never writes that pointer.

### Decision

1. **A pasted key is found, shown and checked.** `public/licence-key-text.mjs`, shared by the app
   and the purchase page, finds the one `KD1.<uuid>.<secret>` key in pasted text, allowing
   whitespace and invisible characters between its characters but not after its end. The key field
   shows what is typed. A partial key is explained before any service call. A non-`KD1` value keeps
   the previous plain rule.
2. **Paste key.** Help > Licence offers Paste key. Only on that click the main process reads the
   clipboard and returns the KerfDesk key it finds, or null; no other clipboard text reaches the
   renderer, and the renderer's clipboard-read permission stays refused.
3. **kerfdesk://licence.** A packaged, non-sandbox commercial Windows build registers the scheme for
   the current user at startup (`app.setAsDefaultProtocolClient`). Exactly `kerfdesk://licence`
   (optionally with a trailing slash) is accepted; any query, path, credential or other host is
   ignored, so a key never travels in a URL. A cold launch or a second launch with the link opens
   Help > Licence once, through a data-free signal and a one-shot route, and the main process then
   reads the clipboard once and pre-fills only a KerfDesk key. Activation still needs the owner's
   click. The NSIS hook is unchanged: its guard forbids registry deletes, so uninstalling leaves the
   per-user `kerfdesk` key behind; following it afterwards does nothing. Installed copies gain this
   from the next release.
4. **The purchase page** shows numbered activation steps and, on Windows, Copy key & open KerfDesk,
   which copies the key and follows the link, with a fallback line if nothing opens.
5. **The download page** leads with the Windows download, its size, its own install steps (including
   SmartScreen's More info > Run anyway and no administrator password) and Unlock Pro steps. It folds
   signature details away and says Preview cannot use a Pro licence or the trial.
6. **The key by email.** After the signed webhook fulfils a new purchase, the licensing Worker asks
   Paddle for the customer's address (`GET /customers/{id}`) and sends the key through a Cloudflare
   Email Service `send_email` binding from `licences@kerfdesk.com`, replying to support. The address
   is never stored, logged or audited; the order records only `sent` or `failed` and a fixed code.
   Sending follows the webhook's answer (`waitUntil`) and never changes fulfilment. Renewals,
   duplicates and refused payments send nothing. It is off (`LICENCE_EMAIL_ENABLED: "false"`) until
   the owner onboards kerfdesk.com to Email Sending and gives the Paddle API key `customer.read`.
   The privacy notice says so.
7. **The first code-signed release can reach unsigned copies.** The manual manifest accepts
   `codeSigning: "authenticode"` as well as `"unsigned"`. Both builds share one app ID, so an
   unsigned copy installs the signed release in place through the existing download-and-close
   consent; the signed build then updates through the signed lane. The publisher does not yet emit
   that manifest; that is the remaining step once a certificate exists.

### Consequences

- No new licence check: Paste key, the link and the email only help enter a key the owner already
  has (AGENTS.md machine and output policy). Frame, Start and output are untouched.
- Copies released before this change only accept `"unsigned"` manifests. Before the signed train
  replaces unsigned releases, publish at least one unsigned release containing this change, then
  publish the signed hand-off to `commercial-manual` with `"authenticode"`.
- Email delivery depends on Cloudflare Email Sending limits and deliverability (SPF, DKIM, DMARC for
  kerfdesk.com). Support still recovers keys by authenticated lookup when an email fails.

### Sources

- [Paddle: Get a customer](https://developer.paddle.com/api-reference/customers/get-customer.md)
- [Paddle: default payment link and `_ptxn`](https://developer.paddle.com/build/transactions/default-payment-link.md)
- [Cloudflare Email Service Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
  and [send binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- Electron `app.setAsDefaultProtocolClient` (installed `electron.d.ts`); electron-builder 26.16.1
  NSIS target, which has no protocol registration

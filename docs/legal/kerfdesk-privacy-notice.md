# KerfDesk Privacy Notice: Licensing and Purchases

> **Final form, pending legal checks. Not yet in force.** Publish as the licensing and purchases
> section of https://kerfdesk.com/privacy/ when sales open. At the same time, remove that page's
> statements that KerfDesk has no activation. This notice must match section 15 of
> `kerfdesk-licence-agreement.md` and ADR-523. Fill in every `[PLACEHOLDER]` first, and see
> `lawyer-review-notes.md`.

Last updated: 29 September 2026. In force from: [PLACEHOLDER: the date sales open].

This notice explains what happens to your information when you try, buy, activate or use a
KerfDesk Pro licence. The rest of our privacy page covers the website and the app in general.

## Who we are

Johann Stolk, trading as KerfDesk [PLACEHOLDER: legal status, and company name and registration
number if different], of [PLACEHOLDER: physical address], South Africa, is responsible for your
information ("we", "us"). Johann Stolk is our Information Officer [PLACEHOLDER: Information
Regulator registration number]. Contact us through https://kerfdesk.com/support.html or at
[PLACEHOLDER: email address, once it exists].

## What we never collect

- KerfDesk does not upload your projects, drawings, toolpaths, or machine or job data.
- KerfDesk has no analytics, telemetry, automatic crash reporting, advertising or tracking.
- Licensing needs no account or password.
- The desktop app keeps a log of its own problems on your computer. It stays there unless you
  choose Help > Save Support Report and send us the file, which never includes your licence key.
  We use a report you send only to answer your request.

## What licensing sends, and why

The desktop app contacts our licensing service at https://license.kerfdesk.com only to register a
trial, to activate, check or deactivate a licence, or to complete a purchase. The web app has no
licence and never contacts it. The desktop app sends only:

- **Your licence key and activation credential,** which prove that you hold a licence. We store
  only a keyed one-way hash of each, never the key itself.
- **An installation digest.** The desktop app makes a one-way hash, specific to KerfDesk, of your
  operating system's installation ID. It does this on your computer, and the raw ID never leaves
  it. We store a keyed hash of the digest to count your active devices and to allow one trial per
  device.
- **A generic device label,** such as "win32 computer", so that your active devices can be listed.
  Your computer's real name is not sent.
- **Order details:** your Paddle transaction ID, and one-time codes that link a purchase to your
  app. We store the codes only as keyed hashes.

We also keep licence, activation and order IDs, your licence type, and dates such as when your trial
ends and your update end date.

When your app connects, our hosting provider, Cloudflare, receives your IP address and standard
connection details. We use your IP address only to limit how many requests one address can make
in a short time, which protects the service. We do not store it in our licence records.

You do not have to use a trial or a licence: Free features work without one. Without the
information above, we cannot provide a trial or a licence.

## Purchases through Paddle

Paddle is our reseller and the merchant of record for every order. When you buy, you give your
payment details, name, email address, country and, where tax rules need it, your address to Paddle,
not to us. Paddle uses them under its own privacy notice at https://www.paddle.com/legal/privacy.
We never see your full card details.

Paddle shares order information with us, such as your email address, your name if you gave one,
your country, what you bought, the price, the tax and the date. We use it only to provide your
licence, give support, handle refunds, prevent fraud and keep the records the law requires. Our
checkout page is the only page on our website that loads Paddle's code, which Paddle uses to take
your payment and prevent fraud.

## Why we use your information

- To provide the trial or licence you asked for, under our agreement with you.
- To prevent abuse and keep the service secure, which is our legitimate interest.
- To keep tax and accounting records, which the law requires.

We do not sell your information. We do not send you marketing emails unless you ask for them.

## Who else handles it

- Cloudflare hosts our licensing service and processes information for us under contract.
- Paddle handles your purchase as reseller and merchant of record, under its own privacy notice.
- Our professional advisers, such as an accountant or lawyer, and public authorities, where the law
  requires.

Cloudflare and Paddle process information in many countries, including outside South Africa. We
rely on their data protection terms to keep it protected.

## How long we keep it

- **Licence records and active devices:** for as long as the licence exists, because a perpetual
  licence needs them to activate new devices.
- **Deactivated devices:** deleted within 90 days of deactivation.
- **Trial records** (a hashed installation digest and dates): deleted 3 years after the trial ends.
- **Order information:** 5 years after we file the tax return that covers the purchase, as South
  African tax law requires.
- **Support messages:** 2 years after our last exchange.
- **IP addresses:** not kept in our records.

If you ask us to delete your licence record, we will, except for records the law requires us to
keep. Devices that are already activated keep working offline, but you will no longer be able to
activate the licence on a new device.

## Your rights

You can ask to see the personal information we hold about you, and ask us to correct or delete it.
You can object to how we use it. We may ask you to show that the licence or order is yours, for
example with your Paddle order number. We will reply within 30 days. If you are not satisfied, you
can complain to South Africa's Information Regulator (https://inforegulator.org.za) or to the data
protection authority where you live.

## Security

We store licence credentials only as keyed hashes, keep our signing keys outside our database, and
sign every licence so that the app can detect a forged one. No system is perfectly secure. If a
breach affects your information, we will tell you and the authorities as the law requires.

## Changes to this notice

When our practices change, we will update this notice and the date at the top.

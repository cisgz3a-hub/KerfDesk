// Editions, prices and checkout for the KerfDesk website.
//
// THE OFFER IS SETTLED; CHECKOUT IS CLOSED. The owner settled the Free and Pro
// editions and the Pro price on 2026-09-29 (ADR-524 Amendment 1), so the site
// shows them. The pages read as if Pro is on sale; until `salesOpen` is true,
// each one opens with the single line "KerfDesk Pro launches soon", and so do
// the pricing, legal and download pages that ship with the app (ADR-524
// Amendment 4). Prices are in `currency` and exclude any sales tax or VAT the
// payment provider adds at checkout.
//
// Changing an edition, a price or a license term is a change to the owner's
// decision: record it in an ADR and update website/tests/commerce.test.mjs in the
// same change. Versions already released keep the terms they were released under.
//
// `trialOpen` says whether the trial is out: the desktop app runs it, so set it
// true once the licensed Windows app is on the download page and the licence
// service is switched on (ADR-524 Amendment 2). Sales cannot open before it.
//
// PURCHASES START IN THE DESKTOP APP, never on this site. The licence service
// creates each Paddle checkout itself and fulfils only the checkouts it created
// (ADR-523), so a payment link or hosted checkout made in Paddle's dashboard
// would take a buyer's money without a license. No plan carries a checkout URL.
//
// Opening sales is a data change here, not new site code:
//   1. A commercial ADR authorizes the first sale (ADR-247 "Consequences").
//      Put its id in `authorizingAdr`.
//   2. Publish the terms of sale and the refund policy; link them below.
//   3. With `trialOpen` already true, set `salesOpen`, then run
//      `pnpm generate:site-pages`: the launch line leaves every page.
// `website/lib/commerce.mjs` refuses to build an open store that is missing any
// of these, and any plan that carries a checkout URL.

export const commerce = {
  trialOpen: false,
  salesOpen: false,
  authorizingAdr: null,
  currency: 'USD',
  termsUrl: null,
  refundPolicyUrl: null,
  // The Free edition: no time limit, in the browser and on the desktop.
  free: {
    name: 'Free',
    includes: [
      'Drawing and text',
      'File import',
      'Basic tracing',
      'Laser cutting and engraving',
      '2D CNC cuts',
      'All machine control',
    ],
  },
  // License plan shape: { id, name, price, billing: 'one-time' | 'yearly',
  //   where, summary, includes: string[], updateYearPrice, deviceLimit,
  //   trialDays }. `where` names the app the plan's tools run in.
  //   `updateYearPrice` buys one more year of updates after the included year;
  //   it is optional and never renews automatically.
  plans: [
    {
      id: 'pro',
      name: 'Pro',
      price: 49.5,
      billing: 'one-time',
      // Pro is desktop only: the owner's choice of 2026-09-29 (ADR-540 item 7).
      where: 'the Windows desktop app',
      summary: 'Everything in Free, plus:',
      includes: [
        'V-carve',
        '3D relief',
        'Adaptive clearing',
        'Advanced tracing',
        'Camera alignment',
        'Box generator',
        'Design Studio',
        'G-code Inspector',
      ],
      updateYearPrice: 20,
      deviceLimit: 3,
      trialDays: 30,
    },
  ],
};

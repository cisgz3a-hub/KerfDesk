// Editions, prices and checkout for the KerfDesk website.
//
// THE OFFER IS SETTLED; CHECKOUT IS CLOSED. The owner settled the Free and Pro
// editions and the Pro price on 2026-09-29 (ADR-524 Amendment 1), so the site
// shows them. No payment provider is live yet, so `salesOpen` stays false: no
// plan carries a checkout URL, and the pricing page says purchase opens soon
// instead of showing a buy button. Prices are in `currency` and exclude any sales
// tax or VAT the payment provider adds at checkout.
//
// Changing an edition, a price or a license term is a change to the owner's
// decision: record it in an ADR and update website/tests/commerce.test.mjs in the
// same change. Versions already released keep the terms they were released under.
//
// Opening checkout later is a data change here, not new site code (the pricing
// page's "purchase opens soon" copy and FAQ still need revising in the same
// change):
//   1. A commercial ADR authorizes the first sale (ADR-247 "Consequences").
//      Put its id in `authorizingAdr`.
//   2. Publish the terms of sale and the refund policy; link them below.
//   3. Create each plan's hosted checkout (a merchant-of-record or payment-link
//      provider) and paste its https URL into `checkoutUrl`, in the same change
//      that sets `salesOpen`.
// `website/lib/commerce.mjs` refuses to build an open store that is missing any
// of these, or a closed one that carries a checkout URL.

export const commerce = {
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
  //   summary, includes: string[], updateYearPrice, deviceLimit, trialDays,
  //   checkoutUrl }. `updateYearPrice` buys one more year of updates after the
  //   included year; it is optional and never renews automatically.
  plans: [
    {
      id: 'pro',
      name: 'Pro',
      price: 49.5,
      billing: 'one-time',
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
      checkoutUrl: null,
    },
  ],
};

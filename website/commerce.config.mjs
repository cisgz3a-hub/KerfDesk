// Pricing and checkout for the KerfDesk website.
//
// SALES ARE CLOSED. KerfDesk is free to use today. The maintainer plans to sell
// paid licenses in the future, but no sale is authorized yet: the first sale
// needs a new, lawyer-reviewed commercial ADR (ADR-247 "Consequences"). While
// `salesOpen` is false the site renders no price, plan or checkout link — draft
// plans below stay invisible, and the pricing page says only that paid licenses
// are planned.
//
// Plans are license plans: each one sells a KerfDesk license, billed either
// 'one-time' or 'yearly'. The license model itself (what a license covers and
// for how long) is for the commercial ADR to decide. Versions already released
// keep the terms they were released under.
//
// Opening sales later is a data change here, not new site code (the pricing
// page's closed-store copy still needs revising in the same change):
//   1. A new lawyer-reviewed commercial ADR authorizes the first sale
//      (ADR-247 "Consequences"). Put its id in `authorizingAdr`.
//   2. Publish terms of sale and a refund policy; link them below.
//   3. Create each plan's hosted checkout (a merchant-of-record or payment-link
//      provider), paste its https URL into `checkoutUrl`, then set `salesOpen`.
// `website/lib/commerce.mjs` refuses to build an open store that is missing
// any of these, and `website/tests/commerce.test.mjs` pins the closed state.

export const commerce = {
  salesOpen: false,
  authorizingAdr: null,
  currency: 'USD',
  termsUrl: null,
  refundPolicyUrl: null,
  // License plan shape: { id, name, price, billing: 'one-time' | 'yearly',
  //                       summary, includes: string[], checkoutUrl }
  plans: [],
};

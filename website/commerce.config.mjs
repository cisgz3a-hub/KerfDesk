// Editions, prices and launch availability for the KerfDesk website.
// The owner authorised checkout and the Windows trial (ADR-562 Amendment 1).
// Purchase and claim use the first-party KerfDesk flow, including mobile (ADR-562);
// never paste a standalone provider payment link into a plan.
// Prices exclude taxes Paddle shows before payment. Update extensions are optional
// one-time purchases. Released versions keep their supplied licence terms.

export const commerce = {
  trialOpen: true,
  salesOpen: true,
  authorizingAdr: 'ADR-562',
  currency: 'USD',
  termsUrl: '/terms/',
  refundPolicyUrl: '/refunds/',
  // The Free edition: no time limit, in the browser and on the desktop.
  free: {
    name: 'Free',
    includes: [
      'Drawing and text',
      'File import',
      'Line Art tracing',
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

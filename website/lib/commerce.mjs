// Validation for website/commerce.config.mjs. The build calls
// `assertValidCommerce` first, so the settled offer always renders complete, no
// plan carries a standalone provider payment link. Browser and desktop purchases
// use the first-party order/claim flow (ADR-562); an open store must be complete.

const BILLING = new Set(['one-time', 'yearly']);
const PLAN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ADR_ID = /^ADR-\d{3,}$/;
const CURRENCY = /^[A-Z]{3}$/;

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isPolicyLink(value) {
  return isHttpsUrl(value) || (typeof value === 'string' && /^\/[a-z0-9/-]*$/.test(value));
}

function isStringList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim())
  );
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function planTermErrors(plan, at) {
  const errors = [];
  if (plan.updateYearPrice !== undefined) {
    if (!Number.isFinite(plan.updateYearPrice) || plan.updateYearPrice <= 0) {
      errors.push(`${at}.updateYearPrice must be > 0`);
    }
  }
  for (const key of ['deviceLimit', 'trialDays']) {
    if (plan[key] !== undefined && !isPositiveInteger(plan[key])) {
      errors.push(`${at}.${key} must be a whole number above 0`);
    }
  }
  return errors;
}

function planErrors(plan, index) {
  const at = `plans[${index}]`;
  const errors = [];
  if (!plan || typeof plan !== 'object') return [`${at} must be an object`];
  if (!PLAN_ID.test(plan.id ?? '')) errors.push(`${at}.id must be kebab-case`);
  if (typeof plan.name !== 'string' || !plan.name.trim()) errors.push(`${at}.name is required`);
  if (!Number.isFinite(plan.price) || plan.price <= 0) errors.push(`${at}.price must be > 0`);
  if (!BILLING.has(plan.billing)) errors.push(`${at}.billing must be one-time or yearly`);
  if (!isStringList(plan.includes)) errors.push(`${at}.includes must be a list of strings`);
  errors.push(...planTermErrors(plan, at));
  // The licence service fulfils only the transactions it creates. Link the
  // first-party purchase page in the view, never a provider payment link.
  if ('checkoutUrl' in plan) {
    errors.push(`${at}.checkoutUrl is not allowed: use the supported KerfDesk purchase flow`);
  }
  return errors;
}

function freeEditionErrors(free) {
  if (!free || typeof free !== 'object') return ['free must describe the Free edition'];
  const errors = [];
  if (typeof free.name !== 'string' || !free.name.trim()) errors.push('free.name is required');
  if (!isStringList(free.includes)) errors.push('free.includes must be a list of strings');
  return errors;
}

export function commerceErrors(commerce) {
  const errors = [];
  if (typeof commerce?.salesOpen !== 'boolean') return ['salesOpen must be true or false'];
  if (typeof commerce.trialOpen !== 'boolean') return ['trialOpen must be true or false'];
  if (!Array.isArray(commerce.plans)) return ['plans must be a list'];
  if (!CURRENCY.test(commerce.currency ?? '')) errors.push('currency must be an ISO 4217 code');
  errors.push(...freeEditionErrors(commerce.free));
  commerce.plans.forEach((plan, index) => {
    errors.push(...planErrors(plan, index));
  });
  const ids = commerce.plans.map((plan) => plan?.id);
  if (new Set(ids).size !== ids.length) errors.push('plan ids must be unique');
  if (commerce.salesOpen) {
    if (!commerce.trialOpen) {
      errors.push(
        'trialOpen must be true before sales open: the licensed Windows app must be available',
      );
    }
    if (!ADR_ID.test(commerce.authorizingAdr ?? '')) {
      errors.push('authorizingAdr must name the commercial ADR that authorizes sales (ADR-247)');
    }
    if (!isPolicyLink(commerce.termsUrl)) errors.push('termsUrl is required before sales open');
    if (!isPolicyLink(commerce.refundPolicyUrl)) {
      errors.push('refundPolicyUrl is required before sales open');
    }
    if (commerce.plans.length === 0) errors.push('at least one plan is required before sales open');
  }
  return errors;
}

export function assertValidCommerce(commerce) {
  const errors = commerceErrors(commerce);
  if (errors.length > 0) {
    throw new Error(`commerce.config.mjs is invalid:\n  - ${errors.join('\n  - ')}`);
  }
}

// en-GB writes US dollars as "US$49.50", which reads unambiguously worldwide
// and matches the app's own download page.
export function formatPrice(price, currency) {
  const whole = Number.isInteger(price);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(price);
}

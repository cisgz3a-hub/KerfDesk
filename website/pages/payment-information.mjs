// Published Supplier Terms, refund policy and settled pricing.
// The full commercial/PAIA review drafts and supplied app licences stay separate.
import { readFileSync } from 'node:fs';
import { blocksHtml, readDocument } from '../../scripts/site-pages-markdown.mjs';
import { pageHero, section } from '../lib/components.mjs';
import { html, raw } from '../lib/html.mjs';
import { publicSellerContact } from '../lib/legal-publication.mjs';
import { page as pricing } from './pricing.mjs';

export const publicPolicySources = Object.freeze([
  {
    path: '/terms/',
    title: 'Software and Supplier Terms',
    source: 'docs/legal/software-supplier-terms.md',
    description:
      'Published KerfDesk software terms, purchased Windows Pro rights, covered-version use and optional updates through Paddle.',
  },
  {
    path: '/refunds/',
    title: 'Refund Policy',
    source: 'docs/legal/refund-promise.md',
    description:
      'How refund requests for a KerfDesk Pro or optional update purchase through Paddle are considered, and the statutory rights that always apply.',
  },
]);

// Each published source must carry this exact version line (ADR-578).
export const PUBLISHED_POLICY_VERSION = 'Version 1.2. Published: 10 October 2026.';

export function publicPolicySourceErrors(source, { versioned = true } = {}) {
  const errors = [];
  if (/\[PLACEHOLDER|Draft for review|not published or in force/i.test(source))
    errors.push('Unfinished review content cannot be a published policy.');
  if (versioned && !source.includes(PUBLISHED_POLICY_VERSION))
    errors.push('A published policy needs its version and confirmed publication date.');
  return errors;
}

function policyPage(policy, { versioned = true } = {}) {
  return {
    ...policy,
    nav: null,
    render: () => {
      const source = readFileSync(new URL('../../' + policy.source, import.meta.url), 'utf8');
      const errors = publicPolicySourceErrors(source, { versioned });
      if (errors.length) throw new Error(policy.source + ': ' + errors.join(' '));
      const document = readDocument(source);
      const body = blocksHtml(document.blocks).replace(
        /href="https:\/\/kerfdesk[.]com\/(terms|refunds|privacy|pricing|license)\/"/g,
        (_, destination) => `href="/${destination}/"`,
      );
      return html`${pageHero({ title: document.title })}${section({
        narrow: true,
        content: html`<div class="prose">${raw(body)}</div>`,
      })}${section({
        id: 'seller',
        narrow: true,
        title: 'Software and licence contact',
        content: publicSellerContact(),
      })}`;
    },
  };
}

export const pricingInformationPage = {
  ...pricing,
  render: (ctx) =>
    html`${pricing.render(ctx)}${section({
      id: 'seller',
      narrow: true,
      title: 'Who makes KerfDesk',
      content: publicSellerContact(),
    })}`,
};

export const softwareTermsPage = policyPage(publicPolicySources[0]);
export const refundPolicyPage = policyPage(publicPolicySources[1]);

// The licence notice, in-app safety text and Supplier Terms link
// kerfdesk.com/safety/. The apex domain is the app (site.config.mjs), so the
// app origin publishes the long-form guide itself (ADR-578). The website keeps
// its own /safety/ page; this one is app output only.
export const appSafetyPage = policyPage(
  {
    path: '/safety/',
    title: 'Safety and responsible use',
    source: 'docs/safety.md',
    description:
      'Machine safety for KerfDesk: checks before every job, staying with the machine, fire response, laser and CNC hazards.',
  },
  { versioned: false },
);
export const paymentInformationPages = Object.freeze([
  pricingInformationPage,
  softwareTermsPage,
  refundPolicyPage,
]);

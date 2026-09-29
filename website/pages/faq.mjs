// FAQ. Questions live in faq-data.mjs, grouped into topic sections; each
// section and each question has an id so other pages can link straight to it.

import { actions, button, ctaBand, faqList, pageHero, section } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';
import { faqSections } from './faq-data.mjs';

function topicLinks(sections) {
  return actions(
    ...sections.map((topic) =>
      button(`#${topic.id}`, topic.title, { variant: 'secondary', size: 'sm' }),
    ),
  );
}

export const page = {
  path: '/faq/',
  nav: 'faq',
  title: 'FAQ',
  description:
    'Answers about KerfDesk: accounts, browsers, offline use, machine support, LightBurn files, framing, the software Abort, Free and Pro, and privacy.',
  render: ({ site, commerce }) => {
    const sections = faqSections(site, commerce);
    return html`${pageHero({
      eyebrow: 'FAQ',
      title: 'Questions and answers',
      lead: 'Straight answers about accounts, browsers, machines, files, cost and your data. Where something hasn’t been tested on a real machine, we say so.',
      extra: topicLinks(sections),
    })}
    ${sections.map((topic, index) =>
      section({
        id: topic.id,
        tone: index % 2 === 1 ? 'alt' : undefined,
        narrow: true,
        title: topic.title,
        content: faqList(topic.items),
      }),
    )}
    ${ctaBand({
      title: 'Still have a question?',
      body: 'Start with the getting-started guide, or go to the KerfDesk support page.',
      buttons: [
        button('/docs/', 'Get started'),
        button(site.supportUrl, 'Get support', { variant: 'ghost-dark' }),
      ],
    })}`;
  },
};

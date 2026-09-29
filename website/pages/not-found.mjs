// 404 page. It is served for any unknown path, so every link here is root-absolute.

import { actions, button, pageHero } from '../lib/components.mjs';

export const page = {
  path: '/404.html',
  nav: null,
  noindex: true,
  title: 'Page not found',
  description: 'This page does not exist on the KerfDesk website.',
  render: ({ site }) =>
    pageHero({
      eyebrow: '404',
      title: 'That page isn’t here',
      lead: `The link may be old or mistyped. If you were looking for the KerfDesk app itself, it runs at ${new URL(site.appUrl).host}.`,
      extra: actions(
        button('/', 'Go to the home page'),
        button(site.appUrl, 'Open the app', { variant: 'secondary' }),
      ),
    }),
};

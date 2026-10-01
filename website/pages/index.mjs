// Every page the site builds, in sitemap order. Pricing and the legal pages are
// the app's own pages (site.pricingUrl and the other links in site.config.mjs).

import { page as about } from './about.mjs';
import { page as cnc } from './cnc.mjs';
import { page as docs } from './docs.mjs';
import { page as download } from './download.mjs';
import { page as faq } from './faq.mjs';
import { page as features } from './features.mjs';
import { page as home } from './home.mjs';
import { page as laser } from './laser.mjs';
import { page as machines } from './machines.mjs';
import { page as notFound } from './not-found.mjs';
import { page as safety } from './safety.mjs';

export const pages = [
  home,
  features,
  laser,
  cnc,
  machines,
  download,
  docs,
  safety,
  faq,
  about,
  notFound,
];

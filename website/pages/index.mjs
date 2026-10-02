// Every page the site builds, in sitemap order.

import { page as about } from './about.mjs';
import { page as cnc } from './cnc.mjs';
import { page as docs } from './docs.mjs';
import { page as download } from './download.mjs';
import { page as faq } from './faq.mjs';
import { page as features } from './features.mjs';
import { page as home } from './home.mjs';
import { page as laser } from './laser.mjs';
import { page as license } from './license.mjs';
import { page as machines } from './machines.mjs';
import { page as notFound } from './not-found.mjs';
import { page as phone } from './phone.mjs';
import { page as pricing } from './pricing.mjs';
import { page as privacy } from './privacy.mjs';
import { page as safety } from './safety.mjs';

export const pages = [
  home,
  features,
  laser,
  cnc,
  machines,
  download,
  pricing,
  docs,
  phone,
  safety,
  faq,
  about,
  privacy,
  license,
  notFound,
];

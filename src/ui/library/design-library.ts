// Bundled design library manifest (ADR-105 G11). The catalog is metadata-rich
// so templates/artwork can be filtered by machine mode, operation, source, and
// professional category before importing through the normal SVG pipeline.

import anchor from 'lucide-static/icons/anchor.svg?raw';
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw';
import beer from 'lucide-static/icons/beer.svg?raw';
import bike from 'lucide-static/icons/bike.svg?raw';
import bird from 'lucide-static/icons/bird.svg?raw';
import cake from 'lucide-static/icons/cake.svg?raw';
import car from 'lucide-static/icons/car.svg?raw';
import cat from 'lucide-static/icons/cat.svg?raw';
import chefHat from 'lucide-static/icons/chef-hat.svg?raw';
import clover from 'lucide-static/icons/clover.svg?raw';
import cloud from 'lucide-static/icons/cloud.svg?raw';
import coffee from 'lucide-static/icons/coffee.svg?raw';
import compass from 'lucide-static/icons/compass.svg?raw';
import crown from 'lucide-static/icons/crown.svg?raw';
import dog from 'lucide-static/icons/dog.svg?raw';
import fish from 'lucide-static/icons/fish.svg?raw';
import flower from 'lucide-static/icons/flower.svg?raw';
import flower2 from 'lucide-static/icons/flower-2.svg?raw';
import gamepad from 'lucide-static/icons/gamepad-2.svg?raw';
import gem from 'lucide-static/icons/gem.svg?raw';
import ghost from 'lucide-static/icons/ghost.svg?raw';
import gift from 'lucide-static/icons/gift.svg?raw';
import guitar from 'lucide-static/icons/guitar.svg?raw';
import heart from 'lucide-static/icons/heart.svg?raw';
import house from 'lucide-static/icons/house.svg?raw';
import key from 'lucide-static/icons/key.svg?raw';
import leaf from 'lucide-static/icons/leaf.svg?raw';
import lightbulb from 'lucide-static/icons/lightbulb.svg?raw';
import moon from 'lucide-static/icons/moon.svg?raw';
import mountain from 'lucide-static/icons/mountain.svg?raw';
import music from 'lucide-static/icons/music.svg?raw';
import plane from 'lucide-static/icons/plane.svg?raw';
import rabbit from 'lucide-static/icons/rabbit.svg?raw';
import rocket from 'lucide-static/icons/rocket.svg?raw';
import sailboat from 'lucide-static/icons/sailboat.svg?raw';
import skull from 'lucide-static/icons/skull.svg?raw';
import smile from 'lucide-static/icons/smile.svg?raw';
import snowflake from 'lucide-static/icons/snowflake.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import squirrel from 'lucide-static/icons/squirrel.svg?raw';
import star from 'lucide-static/icons/star.svg?raw';
import sun from 'lucide-static/icons/sun.svg?raw';
import treeDeciduous from 'lucide-static/icons/tree-deciduous.svg?raw';
import treePine from 'lucide-static/icons/tree-pine.svg?raw';
import trophy from 'lucide-static/icons/trophy.svg?raw';
import turtle from 'lucide-static/icons/turtle.svg?raw';
import utensils from 'lucide-static/icons/utensils.svg?raw';
import wine from 'lucide-static/icons/wine.svg?raw';
import type { LibraryCategory, LibraryEntry } from './design-library-types';

export type { LibraryCategory, LibraryEntry } from './design-library-types';

export const LIBRARY_CATEGORIES: ReadonlyArray<LibraryCategory> = [
  'Laser Templates',
  'CNC Templates',
  'Test & Calibration',
  'Jigs & Fixtures',
  'Boxes & Joinery',
  'Signs & Plaques',
  'Decorative Artwork',
  'Icons & Symbols',
];

const LUCIDE_PROVENANCE = {
  sourceKind: 'lucide',
  license: 'ISC',
  sourceUrl: 'https://lucide.dev/license',
  notice: 'Lucide icons are distributed under the ISC license.',
} as const;

function lucideEntry(args: {
  readonly id: string;
  readonly title: string;
  readonly subcategory: string;
  readonly svgText: string;
  readonly tags?: ReadonlyArray<string>;
}): LibraryEntry {
  const subcategoryTag = args.subcategory.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: `icon-${args.id}`,
    title: args.title,
    category: 'Icons & Symbols',
    subcategory: args.subcategory,
    kind: 'bundled-artwork',
    machineModes: ['laser', 'cnc'],
    operations: ['line'],
    tags: ['icon', 'line-art', subcategoryTag, ...(args.tags ?? [])],
    provenance: LUCIDE_PROVENANCE,
    previewSvgText: args.svgText,
    insert: { kind: 'svg', svgText: args.svgText },
  };
}

export const DESIGN_LIBRARY: ReadonlyArray<LibraryEntry> = [
  lucideEntry({ id: 'bird', title: 'Bird', subcategory: 'Animals', svgText: bird }),
  lucideEntry({ id: 'cat', title: 'Cat', subcategory: 'Animals', svgText: cat }),
  lucideEntry({ id: 'dog', title: 'Dog', subcategory: 'Animals', svgText: dog }),
  lucideEntry({ id: 'fish', title: 'Fish', subcategory: 'Animals', svgText: fish }),
  lucideEntry({ id: 'rabbit', title: 'Rabbit', subcategory: 'Animals', svgText: rabbit }),
  lucideEntry({ id: 'squirrel', title: 'Squirrel', subcategory: 'Animals', svgText: squirrel }),
  lucideEntry({ id: 'turtle', title: 'Turtle', subcategory: 'Animals', svgText: turtle }),
  lucideEntry({ id: 'flower', title: 'Flower', subcategory: 'Nature', svgText: flower }),
  lucideEntry({ id: 'blossom', title: 'Blossom', subcategory: 'Nature', svgText: flower2 }),
  lucideEntry({ id: 'leaf', title: 'Leaf', subcategory: 'Nature', svgText: leaf }),
  lucideEntry({ id: 'clover', title: 'Clover', subcategory: 'Nature', svgText: clover }),
  lucideEntry({ id: 'pine-tree', title: 'Pine tree', subcategory: 'Nature', svgText: treePine }),
  lucideEntry({
    id: 'oak-tree',
    title: 'Oak tree',
    subcategory: 'Nature',
    svgText: treeDeciduous,
  }),
  lucideEntry({ id: 'mountain', title: 'Mountain', subcategory: 'Nature', svgText: mountain }),
  lucideEntry({ id: 'sun', title: 'Sun', subcategory: 'Nature', svgText: sun }),
  lucideEntry({ id: 'moon', title: 'Moon', subcategory: 'Nature', svgText: moon }),
  lucideEntry({ id: 'cloud', title: 'Cloud', subcategory: 'Nature', svgText: cloud }),
  lucideEntry({ id: 'snowflake', title: 'Snowflake', subcategory: 'Nature', svgText: snowflake }),
  lucideEntry({ id: 'heart', title: 'Heart', subcategory: 'Symbols', svgText: heart }),
  lucideEntry({ id: 'star', title: 'Star', subcategory: 'Symbols', svgText: star }),
  lucideEntry({ id: 'sparkles', title: 'Sparkles', subcategory: 'Symbols', svgText: sparkles }),
  lucideEntry({ id: 'crown', title: 'Crown', subcategory: 'Symbols', svgText: crown }),
  lucideEntry({ id: 'gem', title: 'Gem', subcategory: 'Symbols', svgText: gem }),
  lucideEntry({ id: 'music', title: 'Music', subcategory: 'Symbols', svgText: music }),
  lucideEntry({ id: 'smile', title: 'Smile', subcategory: 'Symbols', svgText: smile }),
  lucideEntry({ id: 'ghost', title: 'Ghost', subcategory: 'Symbols', svgText: ghost }),
  lucideEntry({ id: 'skull', title: 'Skull', subcategory: 'Symbols', svgText: skull }),
  lucideEntry({ id: 'anchor', title: 'Anchor', subcategory: 'Symbols', svgText: anchor }),
  lucideEntry({ id: 'arrow', title: 'Arrow', subcategory: 'Symbols', svgText: arrowRight }),
  lucideEntry({ id: 'compass', title: 'Compass', subcategory: 'Symbols', svgText: compass }),
  lucideEntry({ id: 'house', title: 'House', subcategory: 'Home & Food', svgText: house }),
  lucideEntry({ id: 'coffee', title: 'Coffee', subcategory: 'Home & Food', svgText: coffee }),
  lucideEntry({ id: 'wine', title: 'Wine', subcategory: 'Home & Food', svgText: wine }),
  lucideEntry({ id: 'beer', title: 'Beer', subcategory: 'Home & Food', svgText: beer }),
  lucideEntry({ id: 'utensils', title: 'Utensils', subcategory: 'Home & Food', svgText: utensils }),
  lucideEntry({ id: 'chef-hat', title: 'Chef hat', subcategory: 'Home & Food', svgText: chefHat }),
  lucideEntry({ id: 'key', title: 'Key', subcategory: 'Home & Food', svgText: key }),
  lucideEntry({
    id: 'lightbulb',
    title: 'Lightbulb',
    subcategory: 'Home & Food',
    svgText: lightbulb,
  }),
  lucideEntry({ id: 'bike', title: 'Bike', subcategory: 'Hobby & Travel', svgText: bike }),
  lucideEntry({ id: 'car', title: 'Car', subcategory: 'Hobby & Travel', svgText: car }),
  lucideEntry({ id: 'plane', title: 'Plane', subcategory: 'Hobby & Travel', svgText: plane }),
  lucideEntry({ id: 'rocket', title: 'Rocket', subcategory: 'Hobby & Travel', svgText: rocket }),
  lucideEntry({
    id: 'sailboat',
    title: 'Sailboat',
    subcategory: 'Hobby & Travel',
    svgText: sailboat,
  }),
  lucideEntry({ id: 'guitar', title: 'Guitar', subcategory: 'Hobby & Travel', svgText: guitar }),
  lucideEntry({ id: 'gamepad', title: 'Gamepad', subcategory: 'Hobby & Travel', svgText: gamepad }),
  lucideEntry({ id: 'trophy', title: 'Trophy', subcategory: 'Hobby & Travel', svgText: trophy }),
  lucideEntry({ id: 'gift', title: 'Gift', subcategory: 'Hobby & Travel', svgText: gift }),
  lucideEntry({ id: 'cake', title: 'Cake', subcategory: 'Hobby & Travel', svgText: cake }),
];

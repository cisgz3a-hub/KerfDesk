// Bundled design library manifest (ADR-105 G11). A curated LOCAL starter
// set from lucide-static (ISC, MIT-compatible per ADR-017) — stroke-based
// line art that imports engrave-ready through the normal SVG pipeline.
// PROVISIONAL curation; grow by appending imports. Larger/filled artwork
// comes in via Import SVG from CC0 sources (openclipart et al).

import anchor from 'lucide-static/icons/anchor.svg?raw';
import bird from 'lucide-static/icons/bird.svg?raw';
import cat from 'lucide-static/icons/cat.svg?raw';
import dog from 'lucide-static/icons/dog.svg?raw';
import fish from 'lucide-static/icons/fish.svg?raw';
import rabbit from 'lucide-static/icons/rabbit.svg?raw';
import squirrel from 'lucide-static/icons/squirrel.svg?raw';
import turtle from 'lucide-static/icons/turtle.svg?raw';
import flower from 'lucide-static/icons/flower.svg?raw';
import flower2 from 'lucide-static/icons/flower-2.svg?raw';
import leaf from 'lucide-static/icons/leaf.svg?raw';
import clover from 'lucide-static/icons/clover.svg?raw';
import treePine from 'lucide-static/icons/tree-pine.svg?raw';
import treeDeciduous from 'lucide-static/icons/tree-deciduous.svg?raw';
import mountain from 'lucide-static/icons/mountain.svg?raw';
import sun from 'lucide-static/icons/sun.svg?raw';
import moon from 'lucide-static/icons/moon.svg?raw';
import cloud from 'lucide-static/icons/cloud.svg?raw';
import snowflake from 'lucide-static/icons/snowflake.svg?raw';
import heart from 'lucide-static/icons/heart.svg?raw';
import star from 'lucide-static/icons/star.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import crown from 'lucide-static/icons/crown.svg?raw';
import gem from 'lucide-static/icons/gem.svg?raw';
import music from 'lucide-static/icons/music.svg?raw';
import smile from 'lucide-static/icons/smile.svg?raw';
import ghost from 'lucide-static/icons/ghost.svg?raw';
import skull from 'lucide-static/icons/skull.svg?raw';
import house from 'lucide-static/icons/house.svg?raw';
import coffee from 'lucide-static/icons/coffee.svg?raw';
import wine from 'lucide-static/icons/wine.svg?raw';
import beer from 'lucide-static/icons/beer.svg?raw';
import utensils from 'lucide-static/icons/utensils.svg?raw';
import chefHat from 'lucide-static/icons/chef-hat.svg?raw';
import key from 'lucide-static/icons/key.svg?raw';
import lightbulb from 'lucide-static/icons/lightbulb.svg?raw';
import bike from 'lucide-static/icons/bike.svg?raw';
import car from 'lucide-static/icons/car.svg?raw';
import plane from 'lucide-static/icons/plane.svg?raw';
import rocket from 'lucide-static/icons/rocket.svg?raw';
import sailboat from 'lucide-static/icons/sailboat.svg?raw';
import guitar from 'lucide-static/icons/guitar.svg?raw';
import gamepad from 'lucide-static/icons/gamepad-2.svg?raw';
import trophy from 'lucide-static/icons/trophy.svg?raw';
import gift from 'lucide-static/icons/gift.svg?raw';
import cake from 'lucide-static/icons/cake.svg?raw';
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw';
import compass from 'lucide-static/icons/compass.svg?raw';

export type LibraryEntry = {
  readonly name: string;
  readonly category: LibraryCategory;
  readonly svgText: string;
};

export type LibraryCategory = 'Animals' | 'Nature' | 'Symbols' | 'Home & Food' | 'Hobby & Travel';

export const LIBRARY_CATEGORIES: ReadonlyArray<LibraryCategory> = [
  'Animals',
  'Nature',
  'Symbols',
  'Home & Food',
  'Hobby & Travel',
];

function entry(name: string, category: LibraryCategory, svgText: string): LibraryEntry {
  return { name, category, svgText };
}

export const DESIGN_LIBRARY: ReadonlyArray<LibraryEntry> = [
  entry('Bird', 'Animals', bird),
  entry('Cat', 'Animals', cat),
  entry('Dog', 'Animals', dog),
  entry('Fish', 'Animals', fish),
  entry('Rabbit', 'Animals', rabbit),
  entry('Squirrel', 'Animals', squirrel),
  entry('Turtle', 'Animals', turtle),
  entry('Flower', 'Nature', flower),
  entry('Blossom', 'Nature', flower2),
  entry('Leaf', 'Nature', leaf),
  entry('Clover', 'Nature', clover),
  entry('Pine tree', 'Nature', treePine),
  entry('Oak tree', 'Nature', treeDeciduous),
  entry('Mountain', 'Nature', mountain),
  entry('Sun', 'Nature', sun),
  entry('Moon', 'Nature', moon),
  entry('Cloud', 'Nature', cloud),
  entry('Snowflake', 'Nature', snowflake),
  entry('Heart', 'Symbols', heart),
  entry('Star', 'Symbols', star),
  entry('Sparkles', 'Symbols', sparkles),
  entry('Crown', 'Symbols', crown),
  entry('Gem', 'Symbols', gem),
  entry('Music', 'Symbols', music),
  entry('Smile', 'Symbols', smile),
  entry('Ghost', 'Symbols', ghost),
  entry('Skull', 'Symbols', skull),
  entry('Anchor', 'Symbols', anchor),
  entry('Arrow', 'Symbols', arrowRight),
  entry('Compass', 'Symbols', compass),
  entry('House', 'Home & Food', house),
  entry('Coffee', 'Home & Food', coffee),
  entry('Wine', 'Home & Food', wine),
  entry('Beer', 'Home & Food', beer),
  entry('Utensils', 'Home & Food', utensils),
  entry('Chef hat', 'Home & Food', chefHat),
  entry('Key', 'Home & Food', key),
  entry('Lightbulb', 'Home & Food', lightbulb),
  entry('Bike', 'Hobby & Travel', bike),
  entry('Car', 'Hobby & Travel', car),
  entry('Plane', 'Hobby & Travel', plane),
  entry('Rocket', 'Hobby & Travel', rocket),
  entry('Sailboat', 'Hobby & Travel', sailboat),
  entry('Guitar', 'Hobby & Travel', guitar),
  entry('Gamepad', 'Hobby & Travel', gamepad),
  entry('Trophy', 'Hobby & Travel', trophy),
  entry('Gift', 'Hobby & Travel', gift),
  entry('Cake', 'Hobby & Travel', cake),
];

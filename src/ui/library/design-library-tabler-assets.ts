// Exact Tabler 3.43.0 asset imports. `?no-inline` keeps preview bytes out of
// the Library shell; the SVG text is loaded only when an item is added.

import acornUrl from '@tabler/icons/outline/acorn.svg?no-inline';
import anchorUrl from '@tabler/icons/outline/anchor.svg?no-inline';
import appleUrl from '@tabler/icons/outline/apple.svg?no-inline';
import ballBaseballUrl from '@tabler/icons/outline/ball-baseball.svg?no-inline';
import balloonUrl from '@tabler/icons/outline/balloon.svg?no-inline';
import beerUrl from '@tabler/icons/outline/beer.svg?no-inline';
import bikeUrl from '@tabler/icons/outline/bike.svg?no-inline';
import boltUrl from '@tabler/icons/outline/bolt.svg?no-inline';
import buildingCottageUrl from '@tabler/icons/outline/building-cottage.svg?no-inline';
import butterflyUrl from '@tabler/icons/outline/butterfly.svg?no-inline';
import cactusUrl from '@tabler/icons/outline/cactus.svg?no-inline';
import cakeUrl from '@tabler/icons/outline/cake.svg?no-inline';
import catUrl from '@tabler/icons/outline/cat.svg?no-inline';
import chefHatUrl from '@tabler/icons/outline/chef-hat.svg?no-inline';
import chessKnightUrl from '@tabler/icons/outline/chess-knight.svg?no-inline';
import coffeeUrl from '@tabler/icons/outline/coffee.svg?no-inline';
import compassUrl from '@tabler/icons/outline/compass.svg?no-inline';
import crownUrl from '@tabler/icons/outline/crown.svg?no-inline';
import deerUrl from '@tabler/icons/outline/deer.svg?no-inline';
import diamondUrl from '@tabler/icons/outline/diamond.svg?no-inline';
import dogUrl from '@tabler/icons/outline/dog.svg?no-inline';
import fishUrl from '@tabler/icons/outline/fish.svg?no-inline';
import flowerUrl from '@tabler/icons/outline/flower.svg?no-inline';
import giftUrl from '@tabler/icons/outline/gift.svg?no-inline';
import glassUrl from '@tabler/icons/outline/glass.svg?no-inline';
import guitarPickUrl from '@tabler/icons/outline/guitar-pick.svg?no-inline';
import hammerDrillUrl from '@tabler/icons/outline/hammer-drill.svg?no-inline';
import hammerUrl from '@tabler/icons/outline/hammer.svg?no-inline';
import heartUrl from '@tabler/icons/outline/heart.svg?no-inline';
import homeUrl from '@tabler/icons/outline/home.svg?no-inline';
import horseUrl from '@tabler/icons/outline/horse.svg?no-inline';
import keyUrl from '@tabler/icons/outline/key.svg?no-inline';
import leafMapleUrl from '@tabler/icons/outline/leaf-maple.svg?no-inline';
import leafUrl from '@tabler/icons/outline/leaf.svg?no-inline';
import moonStarsUrl from '@tabler/icons/outline/moon-stars.svg?no-inline';
import mountainUrl from '@tabler/icons/outline/mountain.svg?no-inline';
import mugUrl from '@tabler/icons/outline/mug.svg?no-inline';
import pawUrl from '@tabler/icons/outline/paw.svg?no-inline';
import rulerMeasureUrl from '@tabler/icons/outline/ruler-measure.svg?no-inline';
import sailboatUrl from '@tabler/icons/outline/sailboat.svg?no-inline';
import seedlingUrl from '@tabler/icons/outline/seedling.svg?no-inline';
import sparklesUrl from '@tabler/icons/outline/sparkles.svg?no-inline';
import starUrl from '@tabler/icons/outline/star.svg?no-inline';
import toolsKitchenUrl from '@tabler/icons/outline/tools-kitchen-2.svg?no-inline';
import toolsUrl from '@tabler/icons/outline/tools.svg?no-inline';
import trophyUrl from '@tabler/icons/outline/trophy.svg?no-inline';

export type TablerAssetName = keyof typeof TABLER_ASSETS;

type TablerAsset = {
  readonly previewUrl: string;
  readonly loadSvgText: () => Promise<string>;
};

async function svgText(modulePromise: Promise<{ default: string }>): Promise<string> {
  return (await modulePromise).default;
}

export const TABLER_ASSETS = {
  acorn: {
    previewUrl: acornUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/acorn.svg?raw')),
  },
  anchor: {
    previewUrl: anchorUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/anchor.svg?raw')),
  },
  apple: {
    previewUrl: appleUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/apple.svg?raw')),
  },
  'ball-baseball': {
    previewUrl: ballBaseballUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/ball-baseball.svg?raw')),
  },
  balloon: {
    previewUrl: balloonUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/balloon.svg?raw')),
  },
  beer: {
    previewUrl: beerUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/beer.svg?raw')),
  },
  bike: {
    previewUrl: bikeUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/bike.svg?raw')),
  },
  bolt: {
    previewUrl: boltUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/bolt.svg?raw')),
  },
  'building-cottage': {
    previewUrl: buildingCottageUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/building-cottage.svg?raw')),
  },
  butterfly: {
    previewUrl: butterflyUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/butterfly.svg?raw')),
  },
  cactus: {
    previewUrl: cactusUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/cactus.svg?raw')),
  },
  cake: {
    previewUrl: cakeUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/cake.svg?raw')),
  },
  cat: {
    previewUrl: catUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/cat.svg?raw')),
  },
  'chef-hat': {
    previewUrl: chefHatUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/chef-hat.svg?raw')),
  },
  'chess-knight': {
    previewUrl: chessKnightUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/chess-knight.svg?raw')),
  },
  coffee: {
    previewUrl: coffeeUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/coffee.svg?raw')),
  },
  compass: {
    previewUrl: compassUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/compass.svg?raw')),
  },
  crown: {
    previewUrl: crownUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/crown.svg?raw')),
  },
  deer: {
    previewUrl: deerUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/deer.svg?raw')),
  },
  diamond: {
    previewUrl: diamondUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/diamond.svg?raw')),
  },
  dog: {
    previewUrl: dogUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/dog.svg?raw')),
  },
  fish: {
    previewUrl: fishUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/fish.svg?raw')),
  },
  flower: {
    previewUrl: flowerUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/flower.svg?raw')),
  },
  gift: {
    previewUrl: giftUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/gift.svg?raw')),
  },
  glass: {
    previewUrl: glassUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/glass.svg?raw')),
  },
  'guitar-pick': {
    previewUrl: guitarPickUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/guitar-pick.svg?raw')),
  },
  'hammer-drill': {
    previewUrl: hammerDrillUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/hammer-drill.svg?raw')),
  },
  hammer: {
    previewUrl: hammerUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/hammer.svg?raw')),
  },
  heart: {
    previewUrl: heartUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/heart.svg?raw')),
  },
  home: {
    previewUrl: homeUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/home.svg?raw')),
  },
  horse: {
    previewUrl: horseUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/horse.svg?raw')),
  },
  key: {
    previewUrl: keyUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/key.svg?raw')),
  },
  'leaf-maple': {
    previewUrl: leafMapleUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/leaf-maple.svg?raw')),
  },
  leaf: {
    previewUrl: leafUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/leaf.svg?raw')),
  },
  'moon-stars': {
    previewUrl: moonStarsUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/moon-stars.svg?raw')),
  },
  mountain: {
    previewUrl: mountainUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/mountain.svg?raw')),
  },
  mug: {
    previewUrl: mugUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/mug.svg?raw')),
  },
  paw: {
    previewUrl: pawUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/paw.svg?raw')),
  },
  'ruler-measure': {
    previewUrl: rulerMeasureUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/ruler-measure.svg?raw')),
  },
  sailboat: {
    previewUrl: sailboatUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/sailboat.svg?raw')),
  },
  seedling: {
    previewUrl: seedlingUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/seedling.svg?raw')),
  },
  sparkles: {
    previewUrl: sparklesUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/sparkles.svg?raw')),
  },
  star: {
    previewUrl: starUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/star.svg?raw')),
  },
  'tools-kitchen-2': {
    previewUrl: toolsKitchenUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/tools-kitchen-2.svg?raw')),
  },
  tools: {
    previewUrl: toolsUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/tools.svg?raw')),
  },
  trophy: {
    previewUrl: trophyUrl,
    loadSvgText: () => svgText(import('@tabler/icons/outline/trophy.svg?raw')),
  },
} as const satisfies Readonly<Record<string, TablerAsset>>;

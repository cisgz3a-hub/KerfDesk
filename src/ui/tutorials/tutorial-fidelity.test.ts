// Lesson fidelity — the catalog test proves every lesson is well-FORMED
// (ids resolve, visuals render, fields are non-empty, instructions clear a
// length floor). None of that proves a lesson describes the app that
// shipped. A lesson can name a menu KerfDesk does not have, spell the same
// surface two ways in two files, point "Learn next" at itself, or enumerate
// a dialog's groups and miss one — and every existing assertion stays green.
//
// These checks read the real command registry, the real menu labels and the
// real shortcut table, so lesson copy fails here when the app moves under it.

import { describe, expect, it } from 'vitest';
import { shortcutFamilies } from '../common/shortcut-list';
import { TUTORIALS, findTutorial } from './tutorial-catalog';
import type { Tutorial } from './tutorial-types';

// The visible menu-bar labels (AppMenuBar.familyLabel). The 'laser' family's
// label follows the machine kind, so both nouns are legal first segments.
const MENU_LABELS = ['File', 'Edit', 'Tools', 'Arrange', 'Laser', 'Router', 'Window', 'Help'];

// Surfaces that are not menus but legitimately open a location string.
// Anything else starting a "X → Y" path is very likely a menu that moved.
const NON_MENU_PREFIXES = [
  'Top toolbar',
  'Left drawing toolbar',
  'Machine controls',
  'Artwork / Operations',
  'Machine Setup',
  'CNC Startup Setup',
  'Startup Setup',
  'Image Studio',
  'Design Studio',
  'Text formatting',
  'Main workspace',
  'Material Library panel',
  'Console or Super console',
  'Interrupted job saved card',
  'A CNC profile operation',
  'Panels',
  'Text',
  'Crop',
  'Adjust or Filter',
  'Move, free transform or Image menu',
  'Marquee, Lasso or Magic wand',
  'Paint bucket or Gradient',
  'Clone stamp or Spot heal',
  'Select artwork',
  'Select an image',
  'Select vector artwork',
  'Select closed artwork',
  'Select closed shapes',
];

function firstSegment(location: string): string {
  return (location.split('→')[0] ?? '').trim();
}

describe('lesson fidelity against the shipped app', () => {
  it('writes every UI path with one separator, so the catalog reads as one voice', () => {
    // Two eras of authoring left 'Tools > X' in the machine lessons and
    // 'Tools → X' in the design lessons. Readers see one catalog.
    const mixed = TUTORIALS.filter((tutorial) => tutorial.location.includes('>')).map(
      (tutorial) => `${tutorial.id}: ${tutorial.location}`,
    );
    expect(mixed).toEqual([]);
  });

  it('names a real menu whenever a location opens with a menu path', () => {
    const wrong = TUTORIALS.filter((tutorial) => tutorial.location.includes('→'))
      .map((tutorial) => ({ id: tutorial.id, prefix: firstSegment(tutorial.location) }))
      .filter(({ prefix }) => !MENU_LABELS.includes(prefix) && !NON_MENU_PREFIXES.includes(prefix))
      .map(({ id, prefix }) => `${id}: "${prefix}"`);
    expect(wrong).toEqual([]);
  });

  it('never offers a lesson as its own next step', () => {
    const selfReferring = TUTORIALS.filter((tutorial) =>
      tutorial.related.includes(tutorial.id),
    ).map((tutorial) => tutorial.id);
    expect(selfReferring).toEqual([]);
  });

  it('stops a lesson template from giving many tools the same three steps', () => {
    // Nine Image Studio tools and seven Design Studio tools once shared one
    // set of step titles and outcome lines, so sixteen lessons read as one
    // filled-in form. Small families that really are the same action (the four
    // shape tools, the four booleans) stay legal; a template does not.
    const LIMIT = 4;
    const overused = (field: 'title' | 'result'): readonly string[] => {
      const counts = new Map<string, number>();
      for (const tutorial of TUTORIALS)
        for (const step of tutorial.steps)
          counts.set(step[field], (counts.get(step[field]) ?? 0) + 1);
      return [...counts.entries()]
        .filter(([, used]) => used > LIMIT)
        .map(([text, used]) => `${used}x "${text}"`);
    };
    expect(overused('title')).toEqual([]);
    expect(overused('result')).toEqual([]);
  });

  it('keeps the shortcut lesson in step with the shortcut table it describes', () => {
    const lesson = findTutorial('shortcuts');
    expect(lesson).toBeDefined();
    const prose = lessonText(lesson as Tutorial);
    // Every machine-independent family the dialog actually renders.
    const families = shortcutFamilies('laser')
      .map((entry) => entry.family)
      .filter((family) => family !== 'Laser' && family !== 'Router');
    expect(families.filter((family) => !prose.includes(family))).toEqual([]);
    // The job keys are the reason the last group matters; they were missing
    // while the lesson still claimed to list the dialog's groups.
    for (const keys of ['Ctrl+Enter', 'Ctrl+.']) expect(prose, keys).toContain(keys);
  });

  it('does not promise a keyboard Start that skips the Frame gate', () => {
    // Ctrl+Enter calls runStartJobFlow — the Start button's own flow, gates
    // included. Copy that reads as a shortcut PAST the gate would be unsafe.
    const prose = lessonText(findTutorial('shortcuts') as Tutorial).toLocaleLowerCase();
    expect(prose).toContain('frame');
  });
});

function lessonText(tutorial: Tutorial): string {
  return [
    tutorial.summary,
    tutorial.location,
    tutorial.prerequisites,
    tutorial.tip,
    ...tutorial.steps.flatMap((step) => [step.title, step.instruction, step.focus, step.result]),
  ].join(' · ');
}

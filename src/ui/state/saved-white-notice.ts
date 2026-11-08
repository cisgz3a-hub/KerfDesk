// What the open notice and Job Review say about a saved logo whose white
// shapes still burn (rolling audit v10 V2-P2-1, ADR-686 Amendment 2). The
// knock-out reaches new imports only, so a logo imported by KerfDesk 1.0.29 or
// earlier burns its white a second time over the black under it, and the
// canvas paints it black on black. Opening such a project never changes its
// burn: both places name the shapes and offer Leave white unburned, one Undo
// step, from Job Review's row and the Tools menu.

import { countBurningImportedWhites } from '../../core/geometry/burning-imported-white';
import type { Project } from '../../core/scene';

const BURNING_WHITE_PREFIX = 'White in an imported logo burns: ';

/** The Job Review row, or nothing when no imported white still burns. */
export function burningWhiteReviewWarnings(project: Project): ReadonlyArray<string> {
  const count = countBurningImportedWhites(project.scene);
  if (count === 0) return [];
  const one = count === 1;
  return [
    `${BURNING_WHITE_PREFIX}${one ? '1 white shape' : `${count} white shapes`} from an SVG ` +
      `import ${one ? 'burns' : 'burn'} over the darker fill under ${one ? 'it' : 'them'}, as ` +
      'KerfDesk 1.0.29 and earlier imported white. A new import leaves solid white unburned. ' +
      'Use Leave white unburned to do the same here; one Undo burns the white again.',
  ];
}

export function isBurningWhiteWarning(warning: string): boolean {
  return warning.startsWith(BURNING_WHITE_PREFIX);
}

/** The open notice, or null. */
export function burningWhiteOpenNotice(project: Project): string | null {
  const count = countBurningImportedWhites(project.scene);
  if (count === 0) return null;
  const one = count === 1;
  return (
    `This project has ${one ? '1 white shape' : `${count} white shapes`} from an SVG import ` +
    `that ${one ? 'burns' : 'burn'} over the darker fill under ${one ? 'it' : 'them'}, as ` +
    'KerfDesk 1.0.29 and earlier imported white. Its burn is unchanged. To leave the white ' +
    'unburned, as a new import does, choose Tools > Leave Imported White Unburned, or Leave ' +
    'white unburned in Job Review. One Undo burns the white again.'
  );
}

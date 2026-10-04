import type { ConsoleStateEffect } from '../../core/controllers/console-state-effect';

export function stateEffectLabel(effect: Exclude<ConsoleStateEffect, 'read-only'>): string {
  switch (effect) {
    case 'machine-state':
      return 'machine-state command';
    case 'accessories':
      return 'accessory command';
    case 'non-positional':
      return 'non-positional command';
    case 'coordinates-xy':
      return 'XY-coordinate command';
    case 'coordinates-z':
      return 'Z-coordinate command';
    case 'coordinates-all':
      return 'coordinate-system command';
    case 'tool':
      return 'tool-state command';
    case 'reference':
      return 'reference-state command';
    case 'configuration':
      return 'configuration command';
    case 'configuration-nonpositional':
      return 'non-positional configuration command';
  }
}

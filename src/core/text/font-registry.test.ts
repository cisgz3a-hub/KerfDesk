import { describe, expect, it } from 'vitest';
import { FONT_REGISTRY } from './font-registry';

describe('bundled font registry', () => {
  it('contains only the original four outline fonts', () => {
    expect(FONT_REGISTRY).toEqual([
      {
        key: 'roboto-regular',
        displayName: 'Roboto',
        license: 'Apache-2.0',
        styleClass: 'sans',
        geometry: 'outline',
      },
      {
        key: 'inconsolata-regular',
        displayName: 'Inconsolata',
        license: 'OFL-1.1',
        styleClass: 'mono',
        geometry: 'outline',
      },
      {
        key: 'pacifico-regular',
        displayName: 'Pacifico',
        license: 'OFL-1.1',
        styleClass: 'script',
        geometry: 'outline',
      },
      {
        key: 'dancing-script-regular',
        displayName: 'Dancing Script',
        license: 'OFL-1.1',
        styleClass: 'script',
        geometry: 'outline',
      },
    ]);
  });
});

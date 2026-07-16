import { describe, expect, it } from 'vitest';
import { FONT_REGISTRY } from './font-registry';

describe('bundled font registry', () => {
  it('contains four outline fonts and the four approved OFL CNC stroke fonts', () => {
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
      {
        key: 'relief-single-line',
        displayName: 'Relief SingleLine',
        license: 'OFL-1.1',
        styleClass: 'single-line',
        geometry: 'single-line',
      },
      {
        key: 'ems-nixish',
        displayName: 'EMS Nixish',
        license: 'OFL-1.1',
        styleClass: 'single-line',
        geometry: 'single-line',
      },
      {
        key: 'ems-decorous-script',
        displayName: 'EMS Decorous Script',
        license: 'OFL-1.1',
        styleClass: 'single-line',
        geometry: 'single-line',
      },
      {
        key: 'ems-casual-hand',
        displayName: 'EMS Casual Hand',
        license: 'OFL-1.1',
        styleClass: 'single-line',
        geometry: 'single-line',
      },
    ]);
  });
});

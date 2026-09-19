import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../../core/devices';
import { createLayer } from '../../core/scene';
import { readCutSettingsPatch } from './cut-settings-draft';
import { CutPowerModeField } from './CutPowerModeField';

const layer = { ...createLayer({ id: 'laser', color: '#000000' }), powerMode: 'dynamic' as const };

function form(kind: ControllerKind): HTMLFormElement {
  const element = document.createElement('form');
  element.innerHTML = renderToStaticMarkup(
    <CutPowerModeField layer={layer} controllerKind={kind} />,
  );
  return element;
}

describe('controller-specific power controls', () => {
  it('retains editable GRBL dynamic power', () => {
    const element = form('grbl-v1.1');
    const field = element.querySelector('select');
    expect(field?.value).toBe('dynamic');
    expect(field?.selectedOptions[0]?.textContent).toBe('Dynamic (M4)');
    if (field === null) throw new Error('Missing power control');
    field.value = 'constant';
    expect(readCutSettingsPatch(new FormData(element), layer).powerMode).toBe('constant');
  });

  it('offers Smoothieware native intentions without claiming GRBL commands', () => {
    const field = form('smoothieware').querySelector('select');
    expect(field?.value).toBe('dynamic');
    expect(field?.selectedOptions[0]?.textContent).toBe('Proportional to speed');
    expect(field?.textContent).not.toMatch(/M[34]/);
  });

  it.each(['marlin', 'ruida'] as const)(
    'does not offer an ineffective mode switch for %s or rewrite stored intent',
    (kind) => {
      const element = form(kind);
      expect(element.querySelector('[name="powerMode"]')).toBeNull();
      expect(readCutSettingsPatch(new FormData(element), layer).powerMode).toBe('dynamic');
      expect(element.textContent).toContain(kind === 'marlin' ? 'firmware build' : 'Min and Max');
    },
  );
});

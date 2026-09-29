// The tracer rounds Ignore Less Than to whole pixels, so a typed fraction must
// not stay on screen as if it were traced (ADR-560).

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { withControls } from './trace-settings-controls.test-support';

describe('Ignore Less Than number box', () => {
  it('shows the whole-pixel area being traced once a typed value loses focus', async () => {
    await withControls('Line Art', async (controls) => {
      await controls.change('Ignore Less Than', 2.5);
      expect(controls.number('Ignore Less Than').value).toBe('2.5');
      expect(controls.options().ignoreLessThanPixels).toBe(3);
      await act(async () => {
        controls
          .number('Ignore Less Than')
          .dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(controls.number('Ignore Less Than').value).toBe('3');
      expect(controls.options().ignoreLessThanPixels).toBe(3);
    });
  });
});

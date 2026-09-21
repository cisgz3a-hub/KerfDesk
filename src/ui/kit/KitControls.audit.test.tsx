import { describe, expect, it, vi } from 'vitest';
import { button, click, mount } from '../layers/control-audit-test-support';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { RailSection } from './RailSection';

describe('artwork control audit: shared kit controls', () => {
  it('dispatches enabled buttons once suppresses disabled ones and does not submit by default', async () => {
    const action = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    const host = await mount(
      <form onSubmit={submit}>
        <Button onClick={action}>Enabled</Button>
        <Button disabled onClick={action}>
          Disabled
        </Button>
        <IconButton icon="eye" label="Icon enabled" onClick={action} />
        <IconButton icon="eye" label="Icon disabled" disabled onClick={action} />
      </form>,
    );
    await click(button(host, 'Enabled'));
    await click(button(host, 'Icon enabled'));
    expect(action).toHaveBeenCalledTimes(2);
    await click(button(host, 'Disabled'));
    await click(button(host, 'Icon disabled'));
    expect(action).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });
  it('opens and closes a disclosure and opens its actual contextual lesson', async () => {
    const host = await mount(
      <RailSection label="Materials" hint="Presets" tutorialId="materials">
        Recipes
      </RailSection>,
    );
    const details = host.querySelector('details')!;
    const summary = host.querySelector('summary')!;
    expect(details.open).toBe(false);
    await click(summary);
    expect(details.open).toBe(true);
    await click(button(host, 'Tutorial'));
    expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: 'materials' });
    await click(summary);
    expect(details.open).toBe(false);
  });
});

// Save and load a calibration dialog's settings as a preset file, to reuse a
// test layout across materials and machines or share it.

import { usePlatformOptional } from '../app/platform-context';
import { Button } from '../kit';
import { useToastStore } from '../state/toast-store';
import { parseCalibrationPreset, serializeCalibrationPreset } from './calibration-draft-storage';

export function CalibrationPresetButtons<T extends object>(props: {
  readonly kind: string;
  readonly extension: string;
  readonly suggestedName: string;
  readonly draft: T;
  readonly fallback: T;
  readonly fields: ReadonlyArray<keyof T>;
  readonly load: (draft: T) => void;
}): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform === null) return null;
  const toast = useToastStore.getState().pushToast;
  const save = async (): Promise<void> => {
    try {
      const target = await platform.pickFileForSave({
        suggestedName: props.suggestedName,
        extensions: [props.extension],
      });
      if (target === null) return;
      await target.write(
        new Blob([serializeCalibrationPreset(props.kind, props.draft)], {
          type: 'application/json',
        }),
      );
      toast(`Saved test settings to ${target.displayName}.`, 'success');
    } catch (error) {
      toast(`Could not save the preset: ${messageOf(error)}`, 'error');
    }
  };
  const open = async (): Promise<void> => {
    try {
      const files = await platform.pickFilesForOpen({ accept: [props.extension], multiple: false });
      const file = files[0];
      if (file === undefined) return;
      props.load(
        parseCalibrationPreset(props.kind, await file.text(), props.fallback, props.fields),
      );
      toast(`Loaded test settings from ${file.name}.`, 'success');
    } catch (error) {
      toast(`Could not load the preset: ${messageOf(error)}`, 'error');
    }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 4, marginRight: 'auto' }}>
      <Button onClick={() => void save()} title="Save these test settings as a preset file.">
        Save preset...
      </Button>
      <Button onClick={() => void open()} title="Load test settings from a preset file.">
        Load preset...
      </Button>
    </span>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

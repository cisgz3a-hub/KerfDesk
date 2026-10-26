import { useEffect, useRef, useState } from 'react';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
} from '../../core/scene/relief/relief-authoring';
import {
  parseReliefComponentAsset,
  reliefComponentAsset,
  type ReliefComponentAsset,
} from '../../io/project/relief-component-asset';
import { pickPreparedSaveTarget } from '../app/pick-prepared-save-target';
import { usePlatformOptional } from '../app/platform-context';

export function ReliefLocalAssetControls(props: {
  readonly document: ReliefAuthoringDocument;
  readonly component: ReliefComponent | undefined;
  readonly disabled: boolean;
  readonly onPreview: (asset: ReliefComponentAsset) => void;
  readonly onError: (message: string) => void;
}): JSX.Element | null {
  const platform = usePlatformOptional();
  const [busy, setBusy] = useState(false);
  const owner = useRef(0);
  useEffect(() => {
    owner.current += 1;
    setBusy(false);
    return () => {
      owner.current += 1;
    };
  }, [props.document, props.component]);
  if (platform === null) return null;
  async function save(): Promise<void> {
    if (platform === null || props.component === undefined) return;
    const generation = owner.current;
    setBusy(true);
    try {
      // The picker empties an existing file as it returns (ADR-656): the
      // picked file gets the component captured at the click, even if the
      // document changed while the picker was open.
      const json = JSON.stringify(reliefComponentAsset(props.document, props.component), null, 2);
      const target = await pickPreparedSaveTarget(
        platform,
        { suggestedName: 'relief-component.lfrelief', extensions: ['.lfrelief'] },
        { title: 'Save relief component', message: 'The relief component is ready.' },
      );
      if (target !== null) await target.write(json + '\n');
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Could not save relief component.');
    } finally {
      if (generation === owner.current) setBusy(false);
    }
  }
  async function open(): Promise<void> {
    if (platform === null) return;
    const generation = owner.current;
    setBusy(true);
    try {
      const [file] = await platform.pickFilesForOpen({ accept: ['.lfrelief'], multiple: false });
      if (generation !== owner.current || file === undefined) return;
      if ((file.size ?? 0) > 32 * 1024 * 1024)
        throw new Error('Relief component file exceeds 32 MiB.');
      const parsed = parseReliefComponentAsset(await file.text());
      if (generation !== owner.current) return;
      if (parsed.kind === 'error') throw new Error(parsed.reason);
      props.onPreview(parsed.asset);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Could not open relief component.');
    } finally {
      if (generation === owner.current) setBusy(false);
    }
  }
  return (
    <div>
      <button
        title="Save the selected relief component as a reusable local asset"
        type="button"
        disabled={busy || props.disabled || props.component === undefined}
        onClick={() => {
          void save();
        }}
      >
        Save component…
      </button>{' '}
      <button
        title="Open a local relief component asset for preview and insertion"
        type="button"
        disabled={busy || props.disabled}
        onClick={() => {
          void open();
        }}
      >
        Open component…
      </button>
    </div>
  );
}

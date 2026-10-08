import { useEffect, useRef, useState } from 'react';
import type { AiRequest } from '../../core/ai/assistant';
import type { ExperimentPhoto } from '../../core/material-library/material-experiment';
import { readExperimentPhoto } from '../material-library/experiment-photo';
import { Button } from '../kit';

type AiRequestFieldsProps = {
  readonly task: AiRequest['task'];
  readonly setTask: (task: AiRequest['task']) => void;
  readonly prompt: string;
  readonly setPrompt: (prompt: string) => void;
  readonly width: number;
  readonly height: number;
  readonly setWidth: (value: number) => void;
  readonly setHeight: (value: number) => void;
  readonly photo: ExperimentPhoto | null;
  readonly setPhoto: (photo: ExperimentPhoto | null) => void;
  readonly onPreparing: (preparing: boolean) => void;
  readonly onError: (message: string) => void;
  readonly busy: boolean;
  readonly candidateFilter: string;
  readonly setCandidateFilter: (filter: string) => void;
};
export function AiRequestFields(props: AiRequestFieldsProps): JSX.Element {
  return (
    <fieldset disabled={props.busy}>
      <legend>Request to review</legend>
      <label>
        Task{' '}
        <select
          title="Choose vector creation or suggestions from your saved material library."
          aria-label="AI task"
          value={props.task}
          onChange={(event) => props.setTask(event.currentTarget.value as AiRequest['task'])}
        >
          <option value="vector">Create editable vector design</option>
          <option value="material">Suggest saved material recipes</option>
        </select>
      </label>
      {props.task === 'material' ? (
        <label>
          Saved recipe filter{' '}
          <input
            type="search"
            aria-label="AI saved recipe filter"
            title="Search all saved recipe names, descriptions or IDs before choosing the maximum 50 candidates shown in the sent-information preview."
            value={props.candidateFilter}
            onChange={(event) => props.setCandidateFilter(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <label>
        Prompt{' '}
        <textarea
          title="Describe the design or material question. Only this text is sent with the reviewed request."
          aria-label="AI prompt"
          maxLength={4000}
          rows={4}
          value={props.prompt}
          onChange={(event) => props.setPrompt(event.currentTarget.value)}
        />
      </label>
      {props.task === 'vector' ? (
        <>
          <label>
            Width (mm){' '}
            <input
              aria-label="AI design width"
              title="Set the generated design width in millimetres; no machine movement is requested."
              type="number"
              min="1"
              max="1000"
              value={props.width}
              onChange={(event) => props.setWidth(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            Height (mm){' '}
            <input
              aria-label="AI design height"
              title="Set the generated design height in millimetres; no machine movement is requested."
              type="number"
              min="1"
              max="1000"
              value={props.height}
              onChange={(event) => props.setHeight(Number(event.currentTarget.value))}
            />
          </label>
        </>
      ) : null}
      <PhotoField
        photo={props.photo}
        setPhoto={props.setPhoto}
        onError={props.onError}
        onPreparing={props.onPreparing}
      />
    </fieldset>
  );
}
type PhotoFieldProps = {
  readonly photo: ExperimentPhoto | null;
  readonly setPhoto: (photo: ExperimentPhoto | null) => void;
  readonly onError: (message: string) => void;
  readonly onPreparing: (preparing: boolean) => void;
};
function usePhotoPreparation(props: PhotoFieldProps) {
  const [preparing, setPreparing] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);
  const cancel = (): void => {
    sequence.current += 1;
    setPreparing(false);
    props.onPreparing(false);
    props.setPhoto(null);
  };
  const read = async (file: File): Promise<void> => {
    const active = ++sequence.current;
    props.setPhoto(null);
    setPreparing(true);
    props.onPreparing(true);
    try {
      const photo = await readExperimentPhoto(file);
      if (mounted.current && sequence.current === active) props.setPhoto(photo);
    } catch (error) {
      if (mounted.current && sequence.current === active)
        props.onError(error instanceof Error ? error.message : 'Could not prepare this image.');
    } finally {
      if (mounted.current && sequence.current === active) {
        setPreparing(false);
        props.onPreparing(false);
      }
    }
  };
  return { preparing, read, cancel };
}
function PhotoField(props: PhotoFieldProps): JSX.Element {
  const { preparing, read, cancel } = usePhotoPreparation(props);
  return (
    <>
      <label>
        Optional reference photo{' '}
        <input
          aria-label="AI reference photo"
          title="Prepare an optional photo locally for display before sending it to the assistant."
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file !== undefined) void read(file);
          }}
        />
      </label>
      {preparing ? (
        <p role="status">
          Preparing the selected photo for review…{' '}
          <Button
            title="Cancel this photo preparation and exclude its delayed result from the next request."
            onClick={cancel}
          >
            Cancel photo preparation
          </Button>
        </p>
      ) : null}
      {props.photo === null ? null : (
        <figure>
          <img
            src={props.photo.dataUrl}
            alt="Photo that will accompany the AI request"
            style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
          />
          <figcaption>
            {props.photo.width} × {props.photo.height} pixels prepared locally. This photo will be
            sent only when you request a draft.
          </figcaption>
          <Button title="Exclude this photo from the next request." onClick={cancel}>
            Remove photo
          </Button>
        </figure>
      )}
    </>
  );
}

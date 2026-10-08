import { useState } from 'react';
import type { AiCandidate, AiRequest } from '../../core/ai/assistant';
import type { ExperimentPhoto } from '../../core/material-library/material-experiment';
import { machineKindOf } from '../../core/scene';
import { Button } from '../kit';
import { useStore } from '../state';
import { AiRequestFields } from './AiRequestFields';
import { aiMaterialCandidates } from './ai-candidates';
import type { useAiAssistant } from './use-ai-assistant';

export function AiRequestPanel({
  model,
}: {
  readonly model: ReturnType<typeof useAiAssistant>;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const library = useStore((state) => state.materialLibrary);
  const [task, setTask] = useState<AiRequest['task']>('vector');
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [photo, setPhoto] = useState<ExperimentPhoto | null>(null);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [candidateFilter, setCandidateFilter] = useState('');
  const candidates =
    task === 'material'
      ? aiMaterialCandidates(library, machineKindOf(project.machine), candidateFilter)
      : [];
  const dimensionsValid = [width, height].every(
    (value) => Number.isFinite(value) && value >= 1 && value <= 1000,
  );
  const request: AiRequest = {
    task,
    prompt,
    widthMm: width,
    heightMm: height,
    photo: photo?.dataUrl ?? null,
    candidates,
  };
  const enabled =
    !model.busy && !photoPreparing && model.status?.configured && prompt.trim() && dimensionsValid;
  return (
    <>
      <AiRequestFields
        task={task}
        setTask={setTask}
        prompt={prompt}
        setPrompt={setPrompt}
        width={width}
        height={height}
        setWidth={setWidth}
        setHeight={setHeight}
        photo={photo}
        setPhoto={setPhoto}
        onPreparing={setPhotoPreparing}
        candidateFilter={candidateFilter}
        setCandidateFilter={setCandidateFilter}
        onError={model.setError}
        busy={model.busy}
      />
      <AiSentInformation task={task} candidates={candidates} candidateFilter={candidateFilter} />
      <p>
        Request draft sends this information to OpenAI using your API account. Review the returned
        draft before adding artwork or using a saved recipe.
      </p>
      <Button
        title="Send only the reviewed request to OpenAI; return a draft without changing the project."
        disabled={!enabled}
        onClick={() => void model.run(request)}
      >
        Request draft from OpenAI
      </Button>
      {model.busy ? (
        <Button title="Cancel this request and ignore any delayed response." onClick={model.cancel}>
          Cancel request
        </Button>
      ) : null}
    </>
  );
}
function AiSentInformation({
  task,
  candidates,
  candidateFilter,
}: {
  readonly task: AiRequest['task'];
  readonly candidates: ReadonlyArray<AiCandidate>;
  readonly candidateFilter: string;
}): JSX.Element {
  return (
    <details>
      <summary title="Review the complete data that will be sent when you request a draft.">
        Information sent with this request
      </summary>
      <p>
        Your prompt and dimensions, plus any displayed photo and saved recipe names/descriptions
        below. No project file, canvas or machine connection is included.
      </p>
      {task === 'material' ? (
        <p>
          {candidates.length} matching saved recipe{candidates.length === 1 ? '' : 's'} included,
          maximum 50.{' '}
          {candidateFilter.trim() === ''
            ? 'Use the recipe filter to choose a relevant subset from larger libraries.'
            : `Filter: “${candidateFilter.trim()}”. Narrow the filter if more matching recipes exist.`}
        </p>
      ) : null}
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            {candidate.name} · {candidate.description}
          </li>
        ))}
      </ul>
    </details>
  );
}

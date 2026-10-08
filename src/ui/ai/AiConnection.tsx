import { useEffect, useState } from 'react';
import type { AiAssistant, AiStatus } from '../../core/ai/assistant';
import { Button } from '../kit';

export function AiConnection(props: {
  readonly assistant: AiAssistant;
  readonly status: AiStatus | null;
  readonly busy: boolean;
  readonly onStatus: (status: AiStatus) => void;
  readonly onError: (message: string) => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setModel(props.status?.model ?? '');
  }, [props.status?.model]);
  const configured = props.status?.configured === true;
  const secure = props.status?.secureStorage !== false;
  const blocked = props.busy || saving;
  const configure = async (forget: boolean): Promise<void> => {
    setSaving(true);
    try {
      const status = forget
        ? await props.assistant.forget()
        : await props.assistant.configure(key.trim(), model.trim());
      setKey('');
      props.onStatus(status);
    } catch (error) {
      props.onError(
        error instanceof Error ? error.message : 'Could not save assistant configuration.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <details open={!configured}>
      <summary title="Configure a user-owned API account; credentials stay outside project files.">
        OpenAI connection · {configured ? props.status?.model : 'not configured'}
      </summary>
      <p>
        Use your own API account and a model that supports image input and structured responses. API
        charges apply. The key stays in OS encrypted storage outside projects.
      </p>
      <ConnectionFields apiKey={key} setKey={setKey} model={model} setModel={setModel} />
      <Button
        title="Encrypt and save this API key and model on this computer."
        disabled={!canSave(blocked, secure, key, model)}
        onClick={() => void configure(false)}
      >
        Save connection
      </Button>
      <Button
        title="Remove the saved API key from this computer."
        disabled={blocked || !configured}
        onClick={() => void configure(true)}
      >
        Forget API key
      </Button>
      {secure ? null : <p>OS secure storage is unavailable. The API key cannot be saved here.</p>}
    </details>
  );
}
function canSave(blocked: boolean, secure: boolean, key: string, model: string): boolean {
  return !blocked && secure && key.trim().length > 0 && model.trim().length > 0;
}
function ConnectionFields(props: {
  readonly apiKey: string;
  readonly setKey: (key: string) => void;
  readonly model: string;
  readonly setModel: (model: string) => void;
}): JSX.Element {
  return (
    <>
      <label>
        API key{' '}
        <input
          title="Enter your API key. It is never returned by the desktop route or saved in projects."
          aria-label="OpenAI API key"
          type="password"
          autoComplete="off"
          value={props.apiKey}
          onChange={(event) => props.setKey(event.currentTarget.value)}
        />
      </label>
      <label>
        Model ID{' '}
        <input
          title="Use a model available in your API account that supports image inputs and structured responses."
          aria-label="AI model ID"
          value={props.model}
          onChange={(event) => props.setModel(event.currentTarget.value)}
          placeholder="Model available in your API account"
        />
      </label>
    </>
  );
}

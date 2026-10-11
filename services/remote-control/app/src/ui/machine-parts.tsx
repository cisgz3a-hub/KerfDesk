import type { Availability } from '../core/types';
import { Icon, type IconName } from './icons';

export function ActionButton({
  icon,
  label,
  availability,
  onClick,
  primary,
}: {
  icon: IconName;
  label: string;
  availability?: Availability;
  onClick: () => void;
  primary?: boolean;
}) {
  const available = availability?.available !== false;
  return (
    <button
      type="button"
      className={`btn ${primary ? 'btn-primary' : ''}`}
      disabled={!available}
      title={availability?.reason}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}

export function operationLabel(kind: string | undefined, state: string | undefined): string {
  const verb =
    {
      frame: 'Framing',
      job: 'Preparing the job',
      home: 'Homing',
      connect: 'Connecting',
      jog: 'Moving',
      hold: 'Moving',
      origin: 'Setting origin',
      pause: 'Pausing',
      resume: 'Resuming',
      abort: 'Stopping',
      disconnect: 'Disconnecting',
    }[kind ?? ''] ?? 'Working';
  return state === 'starting' ? 'Starting…' : `${verb}…`;
}

import { useStartBlockerStore } from './start-blocker-store';

export function StartBlockerNotice(): JSX.Element | null {
  const messages = useStartBlockerStore((state) => state.messages);
  const attempt = useStartBlockerStore((state) => state.attempt);
  if (messages.length === 0) return null;
  return (
    <div className="lf-banner lf-banner--danger" role="alert" style={noticeStyle}>
      <strong>
        {attempt === 'frame' ? 'Last Frame attempt blocked' : 'Last Start attempt blocked'}
      </strong>
      <ul style={listStyle}>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

const noticeStyle: React.CSSProperties = { fontSize: 12 };
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18 };

import { useStartBlockerStore } from './start-blocker-store';

export function StartBlockerNotice(): JSX.Element | null {
  const messages = useStartBlockerStore((state) => state.messages);
  if (messages.length === 0) return null;
  return (
    <div className="lf-banner lf-banner--danger" role="alert" style={noticeStyle}>
      <strong>Last Start attempt blocked</strong>
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

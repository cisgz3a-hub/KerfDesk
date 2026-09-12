export function CanvasTextSymbols(props: {
  readonly onInsert: (text: string) => void;
}): JSX.Element {
  return (
    <details className="lf-canvas-text-symbols">
      <summary>Accents & symbols</summary>
      <div>
        {['é', 'è', 'ê', 'ë', 'á', 'à', 'â', 'ä', 'í', 'ó', 'ú', 'ñ', 'ç', 'ü', '´'].map((char) => (
          <button
            key={char}
            type="button"
            className="lf-btn"
            aria-label={`Insert ${char}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onInsert(char)}
          >
            {char}
          </button>
        ))}
      </div>
    </details>
  );
}

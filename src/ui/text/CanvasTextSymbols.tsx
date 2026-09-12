export function CanvasTextSymbols(props: {
  readonly onInsert: (text: string) => void;
}): JSX.Element {
  return (
    <details className="lf-canvas-text-symbols">
      <summary title="Show accented letters and symbols to insert at the cursor">
        Accents & symbols
      </summary>
      <div>
        {['é', 'è', 'ê', 'ë', 'á', 'à', 'â', 'ä', 'í', 'ó', 'ú', 'ñ', 'ç', 'ü', '´'].map((char) => (
          <button
            key={char}
            type="button"
            className="lf-btn"
            aria-label={`Insert ${char}`}
            title={`Insert ${char} at the cursor`}
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

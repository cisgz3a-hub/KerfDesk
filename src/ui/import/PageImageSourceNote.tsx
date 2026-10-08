export function PageImageSourceNote(props: { readonly resolutionEditable: boolean }): JSX.Element {
  return (
    <p>
      {props.resolutionEditable
        ? 'Image mode renders this page to bitmap pixels at the selected DPI and keeps its physical size. Choose Editable paths, when available, to retain vector geometry.'
        : 'Image mode retains the source bitmap pixels. Set the engraving density in the image operation after import.'}{' '}
      Canvas and trace previews may use a sampled display; their preview grid is separate from the
      imported pixels and the output sampling grid.
    </p>
  );
}

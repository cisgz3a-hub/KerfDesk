import { useEffect, useRef, useState } from 'react';
import { sceneObjectHasVisibleLayer } from '../../core/scene';
import { usePlatformOptional } from '../app/platform-context';
import { runImagePickAction } from '../commands/image-pick-action';
import { ImageEditorHost } from '../image-editor/ImageEditorHost';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import './design-workspace.css';

/** Photos belong to the current project; the sketch keeps its own draft and Undo. */
export function DesignPhotoWorkspace(): JSX.Element {
  const scene = useStore((s) => s.project.scene);
  const session = useImageEditorStore((s) => s.session);
  const loadState = useImageEditorStore((s) => s.loadState);
  const openEditor = useImageEditorStore((s) => s.openEditor);
  const { importing, importPhoto, available } = useImportStudioPhoto();
  const photos = scene.objects.filter((object) => object.kind === 'raster-image');
  if (session !== null || loadState.kind === 'loading') return <ImageEditorHost embedded />;
  return (
    <section className="design-photos" aria-label="Project photos">
      <div className="design-photos__intro">
        <h2>Photos in this project</h2>
        <p>
          Crop, clean up, add text and prepare a photo for engraving. Import PNG, JPEG, BMP or GIF.
        </p>
        <button
          className="lf-btn lf-btn--primary"
          type="button"
          title="Import a photo into this project and open its editing tools"
          onClick={importPhoto}
          disabled={importing || !available}
        >
          {importing ? 'Importing…' : 'Import photo'}
        </button>
        <p className="design-photos__hint">
          Import adds a photo to your project. Apply keeps the image and its editable layers; save
          the project to keep them on disk. Apply your changes before closing the app.
        </p>
      </div>
      {loadState.kind === 'failed' ? <p role="alert">{loadState.message}</p> : null}
      {photos.length === 0 ? (
        <p>No photos yet. Import one to get started.</p>
      ) : (
        <div className="design-photos__grid">
          {photos.map((photo) => (
            <button
              type="button"
              className="design-photos__card"
              key={photo.id}
              onClick={() => openEditor(photo)}
              aria-label={`Edit photo ${photo.source}`}
              title={`Open ${photo.source} and its editable photo layers`}
              disabled={
                importing || photo.locked === true || !sceneObjectHasVisibleLayer(scene, photo)
              }
            >
              {photo.dataUrl ? <img src={photo.dataUrl} alt="" /> : <span>Photo</span>}
              <strong>{photo.source}</strong>
              <small>
                {photo.pixelWidth} × {photo.pixelHeight} px
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function useImportStudioPhoto() {
  const platform = usePlatformOptional();
  const [importing, setImporting] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const importPhoto = async (): Promise<void> => {
    if (platform === null || importing) return;
    setImporting(true);
    const state = useStore.getState();
    const epoch = state.projectDocumentEpoch;
    const pushToast = useToastStore.getState().pushToast;
    try {
      const imported = await runImagePickAction({
        allowPagedImport: false,
        platform,
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importSvgObject: state.importSvgObject,
        importRasterImage: state.importRasterImage,
        pushToast,
      });
      if (!active.current || useStore.getState().projectDocumentEpoch !== epoch) return;
      // Import may fit/normalise the object: open the actual owned project object.
      const photo = useStore.getState().project.scene.objects.find((o) => o.id === imported?.id);
      if (photo?.kind === 'raster-image') useImageEditorStore.getState().openEditor(photo);
    } catch (error) {
      if (active.current && useStore.getState().projectDocumentEpoch === epoch) {
        pushToast(
          `Could not import photo: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    } finally {
      if (active.current) setImporting(false);
    }
  };
  return { importing, importPhoto, available: platform !== null };
}

import { useStore } from '../state';
import { sceneObjectHasVisibleLayer } from '../../core/scene';
import { rasterDisplayDataUrl } from '../workspace/draw-raster';
import { useDesignStudioStore } from './design-studio-store';
import type { DesignPhotoActions } from './design-project-photos';

export function DesignProjectPhotoList(actions: DesignPhotoActions): JSX.Element | null {
  const scene = useStore((state) => state.project.scene);
  const photos = scene.objects.filter((object) => object.kind === 'raster-image');
  const selected = photos.find((photo) => photo.id === actions.selectedPhotoId);
  if (photos.length === 0) return null;
  return (
    <section
      className="design-selection design-composition-photos"
      aria-label="Photos in this design"
    >
      <h4>Photos ({photos.length})</h4>
      <p className="design-selection__hint">
        Select a photo here or on the canvas. Double-click to edit it.
      </p>
      <div className="design-selection__list">
        {photos.map((photo) => {
          const visible = sceneObjectHasVisibleLayer(scene, photo);
          return (
            <button
              type="button"
              key={photo.id}
              aria-label={`Select photo ${photo.source}`}
              aria-pressed={photo.id === selected?.id}
              disabled={!visible || photo.locked === true}
              onClick={() => {
                const studio = useDesignStudioStore.getState();
                studio.setTool('select');
                studio.setSelection([]);
                if (studio.session?.surface3d === true) studio.toggleSurface3d();
                actions.onSelectPhoto?.(photo.id);
              }}
            >
              <img src={rasterDisplayDataUrl(photo)} alt="" width={36} height={30} />
              <span>{photo.source}</span>
              <small>
                {!visible
                  ? 'Hidden'
                  : photo.locked === true
                    ? 'Locked'
                    : `${photo.pixelWidth} × ${photo.pixelHeight}`}
              </small>
            </button>
          );
        })}
      </div>
      {selected !== undefined ? (
        <button
          type="button"
          className="lf-btn"
          disabled={selected.locked === true || !sceneObjectHasVisibleLayer(scene, selected)}
          onClick={() => actions.onEditPhoto?.(selected.id)}
        >
          Edit selected photo
        </button>
      ) : null}
    </section>
  );
}

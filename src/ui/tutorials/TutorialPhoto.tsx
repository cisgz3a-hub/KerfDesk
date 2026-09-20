import type { TutorialPhoto as Photo } from './tutorial-photos';
import { tutorialPhotoUrl } from './tutorial-photos';

/** Only the open lesson mounts this image. All storyboard stages share one download. */
export function TutorialPhoto(props: {
  readonly photo: Photo;
  readonly phase: number;
  readonly onError: () => void;
}): JSX.Element {
  const { asset, frames } = props.photo;
  const phase = frames.length === 1 ? 0 : props.phase;
  const frame = frames[phase] ?? frames[0];
  return (
    <div className="lf-learn-photo-viewport">
      <img
        className="lf-learn-photo"
        src={tutorialPhotoUrl(asset.small.file)}
        srcSet={`${tutorialPhotoUrl(asset.small.file)} 480w, ${tutorialPhotoUrl(asset.large.file)} 960w`}
        sizes="(max-width: 800px) calc(100vw - 64px), 540px"
        width={asset.large.width}
        height={asset.large.height}
        alt={frame.alt}
        loading="lazy"
        decoding="async"
        onError={props.onError}
        style={{ transform: `translateY(-${(phase * 100) / frames.length}%)` }}
      />
    </div>
  );
}

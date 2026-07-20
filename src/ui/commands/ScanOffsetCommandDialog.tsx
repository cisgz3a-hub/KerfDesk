import {
  generateScanOffsetCalibrationPattern,
  type ScanOffsetCalibrationPatternOptions,
} from '../../core/job';
import { ScanOffsetCalibrationDialog } from '../calibration/ScanOffsetCalibrationDialog';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

export function ScanOffsetCommandDialog(props: { readonly onClose: () => void }): JSX.Element {
  const replaceSceneWithGeneratedScene = useStore((state) => state.replaceSceneWithGeneratedScene);
  const device = useStore((state) => state.project.device);
  const pushToast = useToastStore((state) => state.pushToast);
  const onGenerate = (options: ScanOffsetCalibrationPatternOptions): void => {
    const pattern = generateScanOffsetCalibrationPattern(options);
    replaceSceneWithGeneratedScene(pattern.scene);
    props.onClose();
    const purpose =
      options.mode === 'verification' ? 'profile-corrected verification' : 'uncorrected baseline';
    pushToast(
      `Generated ${purpose} scan offset test (${pattern.cells.length} swatches).`,
      'success',
    );
  };
  return (
    <ScanOffsetCalibrationDialog
      onCancel={props.onClose}
      onGenerate={onGenerate}
      maxFeedMmPerMin={device.maxFeed}
      hasCalibratedOffsets={device.scanningOffsets.length > 0}
    />
  );
}

import React, { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import {
  createFirstRunTestScene,
  markFirstRunGuideComplete,
} from '../../onboarding/FirstRunGuide';
import { useAppDialogsStore } from '../stores/appDialogsStore';
import { FirstRunGuide } from './FirstRunGuide';

export interface AppFirstRunGuideBridgeProps {
  scene: Scene;
  onSceneCommit: (scene: Scene) => void;
}

export function AppFirstRunGuideBridge({
  scene,
  onSceneCommit,
}: AppFirstRunGuideBridgeProps): React.ReactElement | null {
  const showFirstRunGuide = useAppDialogsStore(s => s.showFirstRunGuide);
  const setShowFirstRunGuide = useAppDialogsStore(s => s.setShowFirstRunGuide);
  const setShowConnection = useAppDialogsStore(s => s.setShowConnection);

  const closeGuide = useCallback(() => {
    markFirstRunGuideComplete();
    setShowFirstRunGuide(false);
  }, [setShowFirstRunGuide]);

  const openMachinePanel = useCallback(() => {
    setShowConnection(true);
  }, [setShowConnection]);

  const loadTestScene = useCallback(() => {
    onSceneCommit(createFirstRunTestScene(scene));
  }, [onSceneCommit, scene]);

  if (!showFirstRunGuide) return null;

  return React.createElement(FirstRunGuide, {
    onClose: closeGuide,
    onOpenMachinePanel: openMachinePanel,
    onLoadTestScene: loadTestScene,
  });
}

import React from 'react';
import { AddTextDialog, type AddTextDialogProps } from './AddTextDialog';
import { FontCreditsDialog } from './FontCreditsDialog';

export interface AppTextDialogsProps {
  textDialog: AddTextDialogProps;
  showFontCredits: boolean;
  onCloseFontCredits: () => void;
}

export function AppTextDialogs(props: AppTextDialogsProps): React.ReactElement {
  return React.createElement(React.Fragment, null,
    React.createElement(AddTextDialog, props.textDialog),
    props.showFontCredits && React.createElement(FontCreditsDialog, {
      onClose: props.onCloseFontCredits,
    }),
  );
}

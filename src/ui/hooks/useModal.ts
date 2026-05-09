import { useState, useCallback } from 'react';

type ModalInternal =
  | {
      variant: 'alert';
      title: string;
      message: string;
      details?: string;
      resolve: () => void;
    }
  | {
      variant: 'choice';
      title: string;
      message: string;
      details?: string;
      choices: readonly ModalChoiceOption[];
      resolve: (value: string | null) => void;
    }
  | {
      variant: 'confirm';
      title: string;
      message: string;
      details?: string;
      resolve: (ok: boolean) => void;
    }
  | {
      variant: 'prompt';
      title: string;
      message: string;
      details?: string;
      defaultValue?: string;
      placeholder?: string;
      resolve: (value: string | null) => void;
    }
  | {
      variant: 'confirmWithCheckbox';
      title: string;
      message: string;
      details?: string;
      checkboxLabel: string;
      resolve: (result: { ok: boolean; checkboxChecked: boolean }) => void;
    };

export interface ModalChoiceOption {
  value: string;
  label: string;
  primary?: boolean;
  color?: string;
}

export function useModal() {
  const [modal, setModal] = useState<ModalInternal | null>(null);

  const showAlert = useCallback((title: string, message: string, details?: string): Promise<void> => {
    return new Promise(resolve => {
      setModal({
        variant: 'alert',
        title,
        message,
        details,
        resolve: () => resolve(),
      });
    });
  }, []);

  const showConfirm = useCallback((title: string, message: string, details?: string): Promise<boolean> => {
    return new Promise(resolve => {
      setModal({
        variant: 'confirm',
        title,
        message,
        details,
        resolve,
      });
    });
  }, []);

  const showChoice = useCallback((
    title: string,
    message: string,
    choices: readonly ModalChoiceOption[],
    details?: string,
  ): Promise<string | null> => {
    return new Promise(resolve => {
      setModal({
        variant: 'choice',
        title,
        message,
        details,
        choices,
        resolve,
      });
    });
  }, []);

  const showConfirmWithCheckbox = useCallback((
    title: string,
    message: string,
    checkboxLabel: string,
    details?: string,
  ): Promise<{ ok: boolean; checkboxChecked: boolean }> => {
    return new Promise(resolve => {
      setModal({
        variant: 'confirmWithCheckbox',
        title,
        message,
        details,
        checkboxLabel,
        resolve,
      });
    });
  }, []);

  const showPrompt = useCallback((
    title: string,
    message: string,
    defaultValue?: string,
    placeholder?: string,
    details?: string
  ): Promise<string | null> => {
    return new Promise(resolve => {
      setModal({
        variant: 'prompt',
        title,
        message,
        details,
        defaultValue,
        placeholder,
        resolve,
      });
    });
  }, []);

  const dismissModal = useCallback(() => {
    setModal(m => {
      if (!m) return null;
      if (m.variant === 'confirmWithCheckbox') m.resolve({ ok: false, checkboxChecked: false });
      else if (m.variant === 'confirm') m.resolve(false);
      else if (m.variant === 'choice') m.resolve(null);
      else if (m.variant === 'prompt') m.resolve(null);
      else m.resolve();
      return null;
    });
  }, []);

  const finishAlert = useCallback(() => {
    setModal(m => {
      if (!m || m.variant !== 'alert') return null;
      m.resolve();
      return null;
    });
  }, []);

  const finishConfirm = useCallback((ok: boolean) => {
    setModal(m => {
      if (!m || m.variant !== 'confirm') return null;
      m.resolve(ok);
      return null;
    });
  }, []);

  const finishPrompt = useCallback((value: string | null) => {
    setModal(m => {
      if (!m || m.variant !== 'prompt') return null;
      m.resolve(value);
      return null;
    });
  }, []);

  const finishChoice = useCallback((value: string | null) => {
    setModal(m => {
      if (!m || m.variant !== 'choice') return null;
      m.resolve(value);
      return null;
    });
  }, []);

  const finishConfirmWithCheckbox = useCallback(
    (result: { ok: boolean; checkboxChecked: boolean }) => {
      setModal(m => {
        if (!m || m.variant !== 'confirmWithCheckbox') return null;
        m.resolve(result);
        return null;
      });
    },
    [],
  );

  return {
    modal,
    showAlert,
    showConfirm,
    showChoice,
    showConfirmWithCheckbox,
    showPrompt,
    dismissModal,
    finishAlert,
    finishConfirm,
    finishChoice,
    finishConfirmWithCheckbox,
    finishPrompt,
  };
}

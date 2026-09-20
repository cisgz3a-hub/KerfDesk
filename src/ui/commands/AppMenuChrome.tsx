import type { ReactNode } from 'react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import './AppMenuChrome.css';

export function AppMenuChrome({ children }: { readonly children: ReactNode }): JSX.Element {
  const build = `Built ${__BUILD_TIME__}\nCommit ${__GIT_SHA__}\nVersion ${__APP_VERSION__}`;
  return (
    <header className="lf-menu-chrome">
      <strong className="lf-menu-brand">{APP_DISPLAY_NAME}</strong>
      {children}
      <span className="lf-menu-build" title={build} aria-label="Build version">
        v{__APP_VERSION__}
      </span>
    </header>
  );
}

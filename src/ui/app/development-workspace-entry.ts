/** A real module script keeps the browser's load event behind Vite's cold graph.
 * import() (even top-level await) does not, so a cold dev page otherwise reports
 * loaded while thousands of workspace modules are still arriving. Production
 * uses Vite's bundled import() to retain its hashed JS and CSS dependency URLs.
 */
export function loadDevelopmentWorkspace(document: Document): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/src/ui/app/main.tsx';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        script.remove();
        reject(new Error('Workspace module could not load'));
      },
      { once: true },
    );
    document.head.append(script);
  });
}

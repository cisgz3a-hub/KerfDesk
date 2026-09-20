# Tutorial picture delivery audit

Checked on 2026-09-19 against the current source and installed `vite-plugin-pwa` 1.3.0 / Workbox 7.4.1.

## Delivery decision

Generated pictures belong in `public/tutorial-images/` as compressed, versioned WebP files. Vite copies public files to the output directory; they remain separate files, not JavaScript imports or embedded image data. The tutorial UI must create image requests only for the open lesson. Library cards, startup code and hidden lessons must not preload the pictures.

`vite.config.ts` now explicitly excludes `**/tutorial-images/**` from the service-worker precache. This excludes the entire directory, including any future PNG, SVG or JSON assets, even though the existing precache extension list already omitted WebP. Workbox's default `node_modules` exclusion is retained.

One runtime route handles same-origin `GET` requests whose destination is `image` and whose path contains the exact `/tutorial-images/` directory segment and ends in `.webp`. It supports root deployments and deployments below a path prefix, without capturing ordinary app images, cross-origin URLs, documents or generic fetches.

The route uses `CacheFirst` with cache name `kerfdesk-tutorial-images-v1`. It does not warm the cache or revalidate a cache hit. Only HTTP 200 responses with `Content-Type: image/webp` enter this cache, so an HTML fallback returned for a missing picture is not retained as an image. The configuration limits it to 64 responses and a 30-day expiration age, with quota-error purging. These are entry and age bounds, not a byte budget: compressed file sizes still matter. Workbox performs expiration during cache use; browser storage remains best effort. The configuration follows Workbox's [runtime caching options](https://developer.chrome.com/docs/workbox/modules/workbox-build), [response eligibility](https://developer.chrome.com/docs/workbox/modules/workbox-cacheable-response), and [expiration behavior](https://developer.chrome.com/docs/workbox/modules/workbox-expiration).

## Existing contracts retained

- The app's existing JS, CSS, HTML, SVG, icon, PNG, JSON and font precache patterns remain unchanged outside the picture directory. The 6 MiB per-file precache ceiling remains unchanged.
- `registerType: 'prompt'`, `injectRegister: false`, `PwaUpdateWatcherGate` and the explicit user update action remain intact under ADR-060 and ADR-227. This change does not auto-reload the application.
- Relative Vite `base: './'` remains intact. The CSP already allows same-origin images, so neither CSP nor network permissions need expansion.
- `PwaUpdateWatcherGate` disables service-worker registration for Electron. Its `app://app/` handler in `electron/main.ts` resolves files within `dist/web` through `net.fetch`. Packaged pictures are local files available without a network connection; they add to package size. Use relative image URLs so the same assets resolve in web subpaths and the desktop bundle.
- The learning UI's deterministic SVG illustrations remain the offline/error fallback. An image not previously requested on a page controlled by the new service worker is not guaranteed to exist in the runtime cache. The browser's offline-ready app toast must not be interpreted as a promise that every optional picture has downloaded.

## Integration and verification boundaries

Use a new filename or directory version whenever picture bytes change. A stable URL can keep its cached picture until eviction or expiration; changing only the file on the server does not invalidate `CacheFirst`. Do not add this directory to `includeAssets`, `additionalManifestEntries`, manifest icons or an eager import/preload path. The PWA plugin's explicit asset lists can bypass the directory glob exclusion.

Responsive image variants are separate cache entries. Keep their compressed sizes modest and let the browser select a candidate with `srcset` and `sizes`; avoid fetching both sizes in application code. Return `image/webp` from the web host. A different MIME type prevents runtime storage but does not change the normal image request or SVG fallback path.

The cache policy alone cannot prove that startup creates no image requests. The parent task must verify the integrated UI against a production build because the development server does not enable the service worker by default. Check a fresh controlled page for zero `/tutorial-images/` requests before opening a lesson; open a lesson and confirm only its selected candidate is requested; reopen it and confirm a cache hit; then test offline reopening and an unseen image's SVG fallback. Also inspect the generated precache manifest for absence of this directory. Existing installations may retain the old worker until the normal prompted update is applied.

This audit changes delivery configuration only. It does not generate pictures, modify the reader, operate hardware, publish a build or qualify a packaged desktop runtime.

## Focused verification

`src/platform/web/tutorial-image-delivery.test.ts` evaluates the actual Vite PWA configuration with only the plugin constructor intercepted. It checks root and prefixed picture URLs, origin and request-type isolation, cache eligibility and bounds, explicit precache exclusion, and the unchanged prompt/font/app-shell policy. Run together with the existing `src/platform/web/pwa-precache.test.ts`; browser network and generated-service-worker verification remain separate evidence.

The focused command `pnpm exec vitest run src/platform/web/tutorial-image-delivery.test.ts src/platform/web/pwa-precache.test.ts` passed all 13 tests across two suites. The configuration test uses Vitest's Node environment because loading Vite/esbuild inside jsdom crosses incompatible `TextEncoder`/`Uint8Array` realms; it does not replace browser verification.

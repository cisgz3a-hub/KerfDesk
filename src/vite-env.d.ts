/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_TESTER_HMAC_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

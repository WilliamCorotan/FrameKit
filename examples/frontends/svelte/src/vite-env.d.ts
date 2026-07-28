/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRAMEKIT_API_URL?: string;
  readonly VITE_FRAMEKIT_TENANT_ID?: string;
  readonly VITE_FRAMEKIT_APP_NAME?: string;
  readonly VITE_FRAMEKIT_USER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

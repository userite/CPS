/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CPS_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

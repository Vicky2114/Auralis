/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin for prod (e.g. https://auralis-api.fly.dev). Empty in dev (Vite proxy). */
  readonly VITE_API_BASE?: string;
  readonly VITE_STUN_URL?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

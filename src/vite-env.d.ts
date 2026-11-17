/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Neon Auth for this branch (set by the Vercel Neon integration). The Data API URL is derived from it. */
  readonly VITE_NEON_AUTH_URL: string;
  /** Web Push (daily nudges): the public half of the VAPID key pair. */
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

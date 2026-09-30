/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Web Push (daily nudges): the public half of the VAPID key pair. */
  readonly VITE_VAPID_PUBLIC_KEY: string;
}

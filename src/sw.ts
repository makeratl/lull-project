import { registerSW as register } from 'virtual:pwa-register';

/**
 * A new version installs in the background and takes over on the next launch.
 * Never reload a running app: that would cut the sound off mid-night.
 */
export const registerSW = () => {
  if (import.meta.env.DEV) return;
  register({ immediate: true });
};

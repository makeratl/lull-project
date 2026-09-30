import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev only: serve /api/<name> from api/<name>.ts, the same web-standard handlers Vercel runs,
 * so `npm run dev` needs no `vercel dev`.
 */
const devApi = (): Plugin => ({
  name: 'lull-dev-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return next();
      const file = resolve('api', `${url.pathname.slice(5)}.ts`);
      if (url.pathname.includes('_lib') || !existsSync(file)) {
        res.statusCode = 404;
        return res.end();
      }
      try {
        const mod = await server.ssrLoadModule(file);
        const fn = mod[req.method ?? 'GET'];
        if (!fn) {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        headers.set('x-forwarded-for', req.socket.remoteAddress ?? '127.0.0.1');
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const out: Response = await fn(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body }));
        res.statusCode = out.status;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await out.arrayBuffer()));
      } catch (e) {
        console.error(e);
        res.statusCode = 500;
        res.end('dev api error');
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  // Server-side env for the dev API (Vercel provides these in production).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [
      preact(),
      devApi(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Lull',
          short_name: 'Lull',
          description: 'Ocean, rain and gentle noise for falling asleep.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#11141b',
          theme_color: '#11141b',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // The social card and brand files are for sharing, not for running the app offline.
          globIgnores: ['og.png', 'brand/**'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // New versions wait for the next launch; the running app is never reloaded under the user.
          skipWaiting: false,
          clientsClaim: true,
          runtimeCaching: [
            { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
            // Haunt's clips: fetched only in October, then kept for offline nights.
            { urlPattern: ({ url }) => url.pathname.startsWith('/sounds/'), handler: 'CacheFirst', options: { cacheName: 'lull-sounds' } },
          ],
        },
      }),
    ],
    server: { port: 5190 },
    preview: { port: 5191 },
  };
});

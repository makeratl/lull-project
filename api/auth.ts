import { authBase } from './_lib/http.js';

/**
 * Neon Auth, served from Lull's own origin: /api/auth/<path> → <NEON_AUTH_BASE_URL>/<path>
 * (vercel.json rewrites /api/auth/* to /api/auth?path=*; the dev server does the same).
 *
 * Why: called directly, Neon Auth keeps the session in a cookie on its own domain (SameSite=None,
 * Partitioned). Safari, and so every installed iPhone copy of Lull, treats that as a third-party
 * cookie and drops it, signing people out. Through this proxy the cookie belongs to Lull's origin.
 */
const FORWARD = ['content-type', 'cookie', 'accept', 'user-agent', 'x-neon-client-info', 'authorization'];
const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'cache-control', 'vary', 'server', 'date', 'strict-transport-security', 'alt-svc']);

const proxy = async (req: Request) => {
  const url = new URL(req.url);
  const path = (url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/auth\/?/, '')).replace(/^\/+/, '');
  url.searchParams.delete('path');
  if (!path || path.includes('..')) return Response.json({ error: 'not_found' }, { status: 404 });

  const headers = new Headers();
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Neon Auth checks Origin against its trusted domains; same-origin GETs don't send one, so supply ours.
  headers.set('origin', req.headers.get('origin') ?? url.origin);

  const upstream = await fetch(`${authBase()}/${path}${url.search}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });

  // Pass Neon's headers through (notably `set-auth-jwt`, which carries the JWT the Data API needs), except
  // the ones that describe the upstream connection or encoding, and CORS (this response is same-origin).
  const out = new Headers({ 'Cache-Control': 'no-store' });
  upstream.headers.forEach((v, h) => {
    if (!DROP.has(h) && !h.startsWith('access-control-') && h !== 'set-cookie') out.set(h, v);
  });
  // Keep each cookie host-only on Lull's origin.
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c.replace(/;\s*Domain=[^;]*/i, ''));
  return new Response(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: out });
};

export const GET = proxy;
export const POST = proxy;

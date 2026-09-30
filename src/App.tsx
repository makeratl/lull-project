import { useEffect, useState } from 'preact/hooks';
import { Lull } from './core/lull';
import { Shell } from './ui/Shell';
import { SignIn } from './auth/SignIn';
import { Join } from './auth/Join';
import { Reset } from './auth/Reset';
import { Admin } from './auth/Admin';
import { cachedMe, saveMe, signOut, verify, type Me } from './auth/session';

let core: Lull | null = null;
const getCore = () => {
  if (!core) {
    core = new Lull();
    core.init();
    if (import.meta.env.DEV) (window as unknown as { lull: Lull }).lull = core;
  }
  return core;
};

const usePath = () => {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const nav = (to: string, replace = false) => {
    if (replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    setPath(new URL(to, location.origin).pathname);
  };
  return [path, nav] as const;
};

const RECHECK_MS = 30 * 60_000;

export function App() {
  const [path, nav] = usePath();
  const [me, setMe] = useState<Me | null>(cachedMe);

  const done = (m: Me) => {
    setMe(m);
    nav('/', true);
  };

  const leave = async () => {
    core?.stop();
    await signOut();
    setMe(null);
    nav('/', true);
  };

  // Background session check. Never while sound is playing, and never on a network error.
  useEffect(() => {
    if (!me) return;
    let last = 0;
    const check = async () => {
      if (core?.s.playing || Date.now() - last < 60_000) return;
      last = Date.now();
      const r = await verify();
      if (r === undefined || core?.s.playing) return;
      if (r === null) {
        await signOut();
        setMe(null);
      } else {
        saveMe(r);
        setMe(m => (JSON.stringify(m) === JSON.stringify(r) ? m : r));
      }
    };
    check();
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', check);
    const iv = setInterval(check, RECHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', check);
      clearInterval(iv);
    };
  }, [me?.id]);

  if (path === '/join') return me ? <Redirect to="/" nav={nav} /> : <Join onDone={done} />;
  if (path === '/reset') return <Reset onDone={done} />;
  if (!me) return <SignIn onDone={done} />;
  if (path === '/admin') return me.role === 'admin' ? <Admin me={me} onBack={() => nav('/')} /> : <Redirect to="/" nav={nav} />;
  return <Shell core={getCore()} me={me} onSignOut={leave} onAdmin={() => nav('/admin')} />;
}

function Redirect({ to, nav }: { to: string; nav: (to: string, replace?: boolean) => void }) {
  useEffect(() => nav(to, true), [to]);
  return null;
}

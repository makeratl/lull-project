import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { formatCode, inviteLink } from '../../shared/codes';
import { api, ApiError } from './session';

interface Invite {
  code: string;
  for_whom: string | null;
  status: 'open' | 'redeemed' | 'revoked';
  created_at: string;
  redeemed_at: string | null;
  redeemed_by_name: string | null;
}
interface User {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  joined_at: string;
}

const date = (s: string) => new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const post = <T,>(body: unknown) => api<T>('/api/admin', { method: 'POST', body: JSON.stringify(body) });

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, color: { dark: '#11141b', light: '#f1f3f7' } }).then(setSvg);
  }, [text]);
  return <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Admin({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{ invites: Invite[]; users: User[] } | null>(null);
  const [forWhom, setForWhom] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = () =>
    api<{ invites: Invite[]; users: User[] }>('/api/admin')
      .then(setData)
      .catch(e => setError(e instanceof ApiError && e.status === 403 ? 'Admins only.' : 'Couldn’t load. Are you online?'));
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? `That didn’t work (${e.code}).` : 'That didn’t work. Are you online?');
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch { /* clipboard blocked */ }
  };

  const share = async (url: string) => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Lull', text: 'An invite to Lull, for falling asleep.', url }); } catch { /* cancelled */ }
    } else copy(url, 'link');
  };

  const url = fresh ? inviteLink(location.origin, fresh) : '';

  return (
    <main class="page">
      <div class="page-inner">
        <div class="row-between">
          <span class="brand">Lull</span>
          <button class="btn-quiet" onClick={onBack}>Done</button>
        </div>
        <h1>Invites</h1>
        {error && <span class="error" role="alert">{error}</span>}

        <form
          class="form"
          onSubmit={e => {
            e.preventDefault();
            run(async () => {
              const r = await post<{ invite: { code: string } }>({ action: 'invite', forWhom });
              setFresh(r.invite.code);
              setForWhom('');
            });
          }}
        >
          <label class="field">
            <span class="label">Who is it for? (only you see this)</span>
            <input value={forWhom} maxLength={120} onInput={e => setForWhom((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn-primary" type="submit">Create invite</button>
        </form>

        {fresh && (
          <div class="card" style={{ gap: '16px' }}>
            <Qr text={url} />
            <span class="code" style={{ alignSelf: 'center' }}>{formatCode(fresh)}</span>
            <div class="actions" style={{ justifyContent: 'center' }}>
              <button class="btn-quiet" onClick={() => share(url)}>Share link</button>
              <button class="btn-quiet" onClick={() => copy(url, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
              <button class="btn-quiet" onClick={() => copy(formatCode(fresh), 'code')}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>
            </div>
            <span class="muted" style={{ textAlign: 'center' }}>Single use. It doesn’t expire; revoke it below if it isn’t needed.</span>
          </div>
        )}

        {data && (
          <div class="section">
            <span class="label">All invites</span>
            <div class="list">
              {data.invites.length === 0 && <span class="muted" style={{ padding: '14px 0' }}>None yet.</span>}
              {data.invites.map(i => (
                <div key={i.code} class="list-row">
                  <div class="main">
                    <span class="code" style={{ fontSize: '16px' }}>{formatCode(i.code)}</span>
                    <span class="note">
                      {i.for_whom ? `${i.for_whom} · ` : ''}
                      {i.status === 'redeemed' ? `Joined${i.redeemed_by_name ? ` as ${i.redeemed_by_name}` : ''}, ${date(i.redeemed_at!)}` : i.status === 'revoked' ? 'Revoked' : `Waiting since ${date(i.created_at)}`}
                    </span>
                  </div>
                  {i.status === 'open' && <button class="btn-quiet" onClick={() => run(() => post({ action: 'revoke', code: i.code }))}>Revoke</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div class="section">
            <span class="label">Members</span>
            {link && (
              <div class="card">
                <span class="card-note">Reset link for {link.name}. Send it to them directly; it works once.</span>
                <span class="note" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{link.url}</span>
                <button class="btn-quiet" onClick={() => copy(link.url, 'reset')}>{copied === 'reset' ? 'Copied' : 'Copy reset link'}</button>
              </div>
            )}
            <div class="list">
              {data.users.map(u => (
                <div key={u.id} class="list-row">
                  <div class="main">
                    <span class="title">{u.name}{u.role === 'admin' ? ' · admin' : ''}</span>
                    <span class="note">{u.email} · {u.status === 'suspended' ? 'Paused' : `Joined ${date(u.joined_at)}`}</span>
                  </div>
                  {u.role !== 'admin' && (
                    <div class="actions" style={{ flex: 'none', justifyContent: 'flex-end' }}>
                      <button class="btn-quiet" onClick={() => run(async () => {
                        const r = await post<{ link: string }>({ action: 'reset_link', id: u.id });
                        setLink({ name: u.name, url: r.link });
                      })}>Reset</button>
                      <button class="btn-quiet" onClick={() => run(() => post({ action: u.status === 'active' ? 'suspend' : 'reactivate', id: u.id }))}>
                        {u.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

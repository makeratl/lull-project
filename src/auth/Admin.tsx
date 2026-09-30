import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { formatCode, inviteLink } from '../../shared/codes';
import { api, ApiError, type Me } from './session';
import { buildTree, countTree } from '../../shared/tree';
import { Tree } from '../ui/Tree';

interface Invite {
  code: string;
  for_whom: string | null;
  /** Revoked invites aren't sent: they're dead ends. */
  status: 'open' | 'redeemed';
  created_at: string;
  redeemed_at: string | null;
  redeemed_by_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  expires_at: string | null;
}
interface User {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  invited_by: string | null;
  joined_at: string;
  suspended_at: string | null;
  can_share: boolean;
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

/**
 * Admin: invite people and look after members.
 * Invites show the open ones by default; joined ones are one tap away, revoked ones never.
 */
export function Admin({ me, onBack }: { me: Me; onBack: () => void }) {
  const [data, setData] = useState<{ invites: Invite[]; users: User[] } | null>(null);
  const [forWhom, setForWhom] = useState('');
  /** The invite whose QR and link are shown: a new one, or an open one reopened with Share. */
  const [shown, setShown] = useState<{ code: string; forWhom: string } | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [confirming, setConfirming] = useState('');
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

  const name = forWhom.trim();
  const url = shown ? inviteLink(location.origin, shown.code) : '';
  const open = data?.invites.filter(i => i.status === 'open') ?? [];
  const invites = filter === 'open' ? open : data?.invites ?? [];
  const names = new Map(data?.users.map(u => [u.id, u.name]));
  // Active members first, paused ones after; each in the order they joined.
  const tree = buildTree(data?.users ?? []);
  const users = [...(data?.users ?? [])].sort((a, b) => Number(a.status === 'suspended') - Number(b.status === 'suspended'));

  return (
    <main class="page">
      <div class="page-inner">
        <div class="row-between">
          <span class="brand">Lull</span>
          <button class="btn-quiet" onClick={onBack}>Done</button>
        </div>
        <h1>People</h1>
        {error && <span class="error" role="alert">{error}</span>}

        <form
          class="form"
          onSubmit={e => {
            e.preventDefault();
            if (!name) return;
            run(async () => {
              const r = await post<{ invite: { code: string } }>({ action: 'invite', forWhom: name });
              setShown({ code: r.invite.code, forWhom: name });
              setForWhom('');
              setFilter('open');
            });
          }}
        >
          <label class="field">
            <span class="label">Who is it for?</span>
            <input value={forWhom} maxLength={120} required placeholder="Their name" onInput={e => setForWhom((e.target as HTMLInputElement).value)} />
            <span class="muted">Only admins see this. It’s how you’ll tell your invites apart.</span>
          </label>
          <button class="btn-primary" type="submit" disabled={!name}>Create invite</button>
        </form>

        {shown && (
          <div class="card invite-card">
            <div class="row-between">
              <span class="title">For {shown.forWhom}</span>
              <button class="x" aria-label="Close" onClick={() => setShown(null)}>×</button>
            </div>
            <Qr text={url} />
            <span class="code" style={{ alignSelf: 'center' }}>{formatCode(shown.code)}</span>
            <div class="actions" style={{ justifyContent: 'center' }}>
              <button class="btn-quiet" onClick={() => share(url)}>Share link</button>
              <button class="btn-quiet" onClick={() => copy(url, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
              <button class="btn-quiet" onClick={() => copy(formatCode(shown.code), 'code')}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>
            </div>
            <span class="muted" style={{ textAlign: 'center' }}>Works once. It doesn’t expire; revoke it below if it isn’t needed.</span>
          </div>
        )}

        {data && (
          <div class="section">
            <div class="row-between">
              <span class="label">Invites</span>
              <div class="seg" role="group" aria-label="Show invites">
                <button class={filter === 'open' ? 'on' : ''} aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Waiting · {open.length}</button>
                <button class={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All · {data.invites.length}</button>
              </div>
            </div>
            <div class="list">
              {invites.length === 0 && <span class="muted" style={{ padding: '14px 0' }}>{filter === 'open' ? 'No one is waiting on an invite.' : 'No invites yet.'}</span>}
              {invites.map(i => (
                <div key={i.code} class="list-row">
                  <div class="main">
                    <span class="title">{i.for_whom || 'Unnamed invite'}</span>
                    <span class="note">
                      {i.status === 'redeemed'
                        ? `Joined${i.redeemed_by_name && i.redeemed_by_name !== i.for_whom ? ` as ${i.redeemed_by_name}` : ''} · ${date(i.redeemed_at!)}`
                        : `${formatCode(i.code)} · waiting since ${date(i.created_at)}${i.expires_at ? ` · until ${date(i.expires_at)}` : ''}`}
                      {i.created_by && i.created_by !== me.id && i.created_by_name ? ` · shared by ${i.created_by_name}` : ''}
                    </span>
                  </div>
                  {i.status === 'open' && (
                    <div class="actions" style={{ flex: 'none', justifyContent: 'flex-end' }}>
                      {confirming === i.code ? (
                        <>
                          <button class="btn-quiet" onClick={() => setConfirming('')}>Keep</button>
                          <button class="btn-quiet danger" onClick={() => { setConfirming(''); if (shown?.code === i.code) setShown(null); run(() => post({ action: 'revoke', code: i.code })); }}>Revoke</button>
                        </>
                      ) : (
                        <>
                          <button class="btn-quiet" onClick={() => { setShown({ code: i.code, forWhom: i.for_whom || 'someone' }); scrollTo({ top: 0, behavior: 'smooth' }); }}>Share</button>
                          <button class="btn-quiet" onClick={() => setConfirming(i.code)}>Revoke…</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div class="section">
            <span class="label">Members · {data.users.length}</span>
            <span class="muted">Members use Lull on their own devices; their sounds and settings never leave them. Anyone can share Lull (up to 5 invites waiting, each good for 30 days). Admins can also invite without limits, pause a member, stop someone sharing, and make a password reset link.</span>
            {link && (
              <div class="card">
                <span class="card-note">Reset link for {link.name}. Send it to them directly; it works once.</span>
                <span class="note" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{link.url}</span>
                <button class="btn-quiet" onClick={() => copy(link.url, 'reset')}>{copied === 'reset' ? 'Copied' : 'Copy reset link'}</button>
              </div>
            )}
            <div class="list">
              {users.map(u => (
                <div key={u.id} class={`list-row${u.status === 'suspended' ? ' paused' : ''}`}>
                  <div class="main">
                    <span class="title">
                      {u.name}
                      {u.id === me.id && <span class="badge">You</span>}
                      {u.role === 'admin' && <span class="badge">Admin</span>}
                      {u.status === 'suspended' && <span class="badge dim">Paused</span>}
                      {u.role !== 'admin' && !u.can_share && <span class="badge dim">Can’t share</span>}
                    </span>
                    <span class="note">
                      {u.email} · {u.status === 'suspended' && u.suspended_at ? `paused ${date(u.suspended_at)}` : `joined ${date(u.joined_at)}`}
                      {u.invited_by && names.get(u.invited_by) && u.invited_by !== me.id ? ` · invited by ${names.get(u.invited_by)}` : ''}
                    </span>
                  </div>
                  {u.role !== 'admin' && (
                    <div class="actions" style={{ flex: 'none', justifyContent: 'flex-end' }}>
                      <button class="btn-quiet" onClick={() => run(async () => {
                        const r = await post<{ link: string }>({ action: 'reset_link', id: u.id });
                        setLink({ name: u.name, url: r.link });
                      })}>Reset link</button>
                      <button class="btn-quiet" onClick={() => run(() => post({ action: 'sharing', id: u.id, on: !u.can_share }))}>
                        {u.can_share ? 'Stop sharing' : 'Allow sharing'}
                      </button>
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
        {data && (
          <div class="section">
            <span class="label">Family tree · {countTree(tree)}</span>
            <span class="muted">Who joined through whom. Each member sees only their own branch.</span>
            <Tree nodes={tree} badge={n => (n.id === me.id ? 'You' : null)} />
          </div>
        )}
      </div>
    </main>
  );
}

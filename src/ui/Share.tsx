import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { formatCode, inviteLink } from '../../shared/codes';
import type { TreeNode } from '../../shared/tree';
import { api, ApiError } from '../auth/session';
import { Tree } from './Tree';

interface Invite {
  code: string;
  for_whom: string | null;
  created_at: string;
  expires_at: string | null;
}
interface Data {
  canShare: boolean;
  limit: number | null;
  invites: Invite[];
  branch: TreeNode[];
  branchSize: number;
}

const post = <T,>(body: unknown) => api<T>('/api/share', { method: 'POST', body: JSON.stringify(body) });
const short = (s: string) => new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric' });

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, color: { dark: '#11141b', light: '#f1f3f7' } }).then(setSvg);
  }, [text]);
  return <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const MESSAGES: Record<string, string> = {
  limit: 'You have 5 invites waiting. When someone joins, or you take one back below, you can make another.',
  sharing_off: 'Sharing is turned off for your account.',
};

/**
 * Share Lull: opens straight to an invite's QR code and link (your newest unnamed one, or a fresh one),
 * with an optional name, your other open invites, and your branch of the tree.
 */
export function Share({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [shown, setShown] = useState<Invite | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [confirming, setConfirming] = useState('');

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? MESSAGES[e.code] ?? `That didn’t work (${e.code}).` : 'Can’t reach Lull right now. Sharing needs a connection.');

  const load = () => api<Data>('/api/share').then(d => { setData(d); return d; });

  const fresh = async () => {
    setError('');
    try {
      const r = await post<{ invite: Invite }>({ action: 'create' });
      setShown(r.invite);
      setName('');
      await load();
    } catch (e) { fail(e); }
  };

  // Open on an invite ready to hand over: the newest unnamed open one, else a new one.
  useEffect(() => {
    load()
      .then(d => {
        if (!d.canShare) return setError(MESSAGES.sharing_off);
        const ready = d.invites.find(i => !i.for_whom);
        if (ready) setShown(ready);
        else fresh();
      })
      .catch(fail);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await load(); } catch (e) { fail(e); }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch { /* clipboard blocked */ }
  };
  const url = shown ? inviteLink(location.origin, shown.code) : '';
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Lull', text: 'An invite to Lull, for falling asleep.', url }); } catch { /* cancelled */ }
    } else copy(url, 'link');
  };
  const others = data?.invites.filter(i => i.code !== shown?.code) ?? [];

  return (
    <>
      <div class="menu-backdrop" onClick={onClose} />
      <div class="practice share" role="dialog" aria-label="Share Lull">
        <div class="row-between">
          <span class="practice-title">Share Lull</span>
          <button class="done" onClick={onClose}>Done</button>
        </div>
        {error && <span class="error" role="alert">{error}</span>}

        {shown && (
          <div class="card invite-card">
            <Qr text={url} />
            <span class="code" style={{ alignSelf: 'center' }}>{formatCode(shown.code)}</span>
            <div class="actions" style={{ justifyContent: 'center' }}>
              <button class="btn-quiet" onClick={share}>Share link</button>
              <button class="btn-quiet" onClick={() => copy(url, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
            </div>
            {shown.for_whom ? (
              <span class="muted" style={{ textAlign: 'center' }}>For {shown.for_whom}</span>
            ) : (
              <form
                class="share-name"
                onSubmit={e => {
                  e.preventDefault();
                  const n = name.trim();
                  if (!n) return;
                  run(async () => {
                    await post({ action: 'label', code: shown.code, forWhom: n });
                    setShown({ ...shown, for_whom: n });
                  });
                }}
              >
                <input value={name} maxLength={120} placeholder="Who’s it for? (optional)" onInput={e => setName((e.target as HTMLInputElement).value)} aria-label="Who is it for (optional)" />
                {name.trim() && <button class="btn-quiet" type="submit">Save</button>}
              </form>
            )}
            <span class="muted" style={{ textAlign: 'center' }}>
              Works once{shown.expires_at ? `, until ${short(shown.expires_at)}` : ''}. They scan it or open the link to make their account.
            </span>
          </div>
        )}
        {data?.canShare && shown && (
          <button class="btn-quiet" style={{ alignSelf: 'center' }} onClick={fresh}>New invite for someone else</button>
        )}

        {others.length > 0 && (
          <div class="section">
            <span class="label">Waiting{data?.limit ? ` · ${data.invites.length} of ${data.limit}` : ''}</span>
            <div class="list">
              {others.map(i => (
                <div key={i.code} class="list-row">
                  <div class="main">
                    <span class="title">{i.for_whom || `Invite from ${short(i.created_at)}`}</span>
                    <span class="note">{formatCode(i.code)}{i.expires_at ? ` · until ${short(i.expires_at)}` : ''}</span>
                  </div>
                  <div class="actions" style={{ flex: 'none', justifyContent: 'flex-end' }}>
                    {confirming === i.code ? (
                      <>
                        <button class="btn-quiet" onClick={() => setConfirming('')}>Keep</button>
                        <button class="btn-quiet danger" onClick={() => { setConfirming(''); run(() => post({ action: 'revoke', code: i.code })); }}>Take back</button>
                      </>
                    ) : (
                      <>
                        <button class="btn-quiet" onClick={() => setShown(i)}>Show</button>
                        <button class="btn-quiet" onClick={() => setConfirming(i.code)}>Take back…</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div class="section">
            <span class="label">Your branch{data.branchSize ? ` · ${data.branchSize}` : ''}</span>
            {data.branch.length ? (
              <Tree nodes={data.branch} />
            ) : (
              <span class="note">When someone joins with your invite, they appear here, and so do the people they share with.</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

import { useState } from 'preact/hooks';
import { AuthPage, Field } from './SignIn';
import { loadProfile, saveMe, supabase, type Me } from './session';

/** Reset a password from an admin-generated link: /reset?token_hash=… (no email involved). */
export function Reset({ onDone }: { onDone: (me: Me) => void }) {
  const tokenHash = new URLSearchParams(location.search).get('token_hash') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(tokenHash ? '' : 'This reset link is incomplete. Ask for a new one.');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (password.length < 10) return setError('Use at least 10 characters.');
    setBusy(true);
    setError('');
    try {
      const { data, error: otpErr } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
      if (otpErr || !data.user) throw new Error('This reset link has expired or was already used. Ask for a new one.');
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw new Error('That password wasn’t accepted. Try a longer one.');
      const me = await loadProfile(data.user.id);
      saveMe(me);
      onDone(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <AuthPage title="New password" lede="Choose a new password for Lull.">
      <form class="form" onSubmit={submit}>
        <Field label="New password (10+ characters)" type="password" autocomplete="new-password" minLength={10} value={password} onInput={setPassword} />
        {error && <span class="error" role="alert">{error}</span>}
        <button class="btn-primary" type="submit" disabled={busy || !tokenHash}>{busy ? 'Saving…' : 'Save and sign in'}</button>
      </form>
    </AuthPage>
  );
}

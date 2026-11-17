import { useState } from 'preact/hooks';
import { AuthPage, Field } from './SignIn';
import { loadProfile, resetPassword, saveMe, signIn, supabase, type Me } from './session';

/**
 * Set a new password from a reset link: /reset?token=… — emailed by "Forgot your password?" or made by an admin.
 * (Links from before the move to Neon used ?token_hash=; those no longer work.)
 */
export function Reset({ onDone }: { onDone: (me: Me) => void }) {
  const params = new URLSearchParams(location.search);
  // The token may also come after '#': fragments survive login redirects and never reach server logs.
  const token = params.get('token') ?? new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? '' : params.get('error') ? 'This reset link has expired or was already used. Ask for a new one.' : 'This reset link is incomplete. Ask for a new one.');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (password.length < 10) return setError('Use at least 10 characters.');
    setBusy(true);
    setError('');
    try {
      await resetPassword(token, password);
      // A reset doesn't sign anyone in: do it now with the new password.
      const me = await signIn(email, password).catch(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Your password is set. Sign in with it.');
        return loadProfile(user.id);
      });
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
        <Field label="Your email" type="email" autocomplete="email" value={email} onInput={setEmail} />
        <Field label="New password (10+ characters)" type="password" autocomplete="new-password" minLength={10} value={password} onInput={setPassword} />
        {error && <span class="error" role="alert">{error}</span>}
        <button class="btn-primary" type="submit" disabled={busy || !token}>{busy ? 'Saving…' : 'Save and sign in'}</button>
      </form>
    </AuthPage>
  );
}

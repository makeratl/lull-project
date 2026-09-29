/**
 * Create the first admin once. Needs SUPABASE_SERVICE_ROLE_KEY.
 *   npm run bootstrap                 local stack (reads .env.local, then .env)
 *   npm run bootstrap:prod            production (reads .env.production.local)
 * Prints a one-time password; sign in, then use a reset link or the Supabase dashboard to change it.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

config({ path: process.env.ENV_FILE ? [process.env.ENV_FILE] : ['.env.local', '.env'], quiet: true });
const email = (process.env.ADMIN_EMAIL || 'steven@makeratl.com').trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim() || 'Steven';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: existing, error: qErr } = await sb.from('profiles').select('id').eq('role', 'admin').limit(1);
if (qErr) throw qErr;
if (existing?.length) {
  console.log('An admin already exists; nothing to do.');
  process.exit(0);
}
const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
if (error) throw error;
const uid = data.user!.id;
const { error: pErr } = await sb.from('profiles').insert({ id: uid, name, email, role: 'admin' });
if (pErr) {
  await sb.auth.admin.deleteUser(uid);
  throw pErr;
}
console.log(`Admin created: ${email}`);
if (!process.env.ADMIN_PASSWORD) console.log(`One-time password: ${password}`);

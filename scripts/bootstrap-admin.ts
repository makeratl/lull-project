/**
 * Create the first admin once, on an empty Neon database. Needs DATABASE_URL and NEON_AUTH_BASE_URL.
 *   npm run bootstrap                 dev branch (reads .env.local, then .env)
 *   npm run bootstrap:prod            production (reads .env.production.local)
 * Prints a one-time password; sign in, then change it under Account.
 */
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';

config({ path: process.env.ENV_FILE ? [process.env.ENV_FILE] : ['.env.local', '.env'], quiet: true });
const email = (process.env.ADMIN_EMAIL || 'steven@makeratl.com').trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim() || 'Steven';
if (!process.env.DATABASE_URL || !process.env.NEON_AUTH_BASE_URL) throw new Error('Set DATABASE_URL and NEON_AUTH_BASE_URL');
const sql = neon(process.env.DATABASE_URL);

if ((await sql`select 1 from profiles where role = 'admin' limit 1`).length) {
  console.log('An admin already exists; nothing to do.');
  process.exit(0);
}
const password = process.env.ADMIN_PASSWORD || randomBytes(12).toString('base64url');
const r = await fetch(`${process.env.NEON_AUTH_BASE_URL}/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: process.env.APP_ORIGIN || 'http://localhost:5190' },
  body: JSON.stringify({ email, password, name }),
});
const body = (await r.json()) as { user?: { id: string }; message?: string };
if (!r.ok || !body.user) throw new Error(`sign-up failed: ${body.message ?? r.status}`);
const uid = body.user.id;
try {
  await sql`insert into profiles (id, name, email, role) values (${uid}, ${name}, ${email}, 'admin')`;
} catch (e) {
  await sql`delete from neon_auth."user" where id = ${uid}`;
  throw e;
}
console.log(`Admin created: ${email}`);
if (!process.env.ADMIN_PASSWORD) console.log(`One-time password: ${password}`);

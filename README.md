# Lull

A private, invite-only PWA for falling asleep:
- generated ocean, rain, fan, stream and noise soundscapes
- a sleep timer with a long fade
- a near-black dim screen
- paced breathing

Built from the design handoff in `reference/` (the spec is `reference/README.md`).

- **App:** Vite + Preact + TypeScript. All sound is generated on the device with Web Audio; there are no audio files.
- **Accounts:** Supabase Auth with invite codes (the wellofwyrd pattern), plus three Vercel functions in `api/`. Only admins create invites.
- **Offline-first:** once signed in, the app opens and plays with no network. Sessions are re-checked only when online and **never while sound is playing**.

## Layout

| Path | What |
|---|---|
| `src/core/` | Framework-free engine: the `lull-core.js` port (`lull.ts`, `engine.ts`, `recipes.ts`), the view model, and lock-screen safe mode (`safeMode.ts`) |
| `src/ui/` | Screens, sheet, gestures, styles (design tokens are in `styles.css`) |
| `src/auth/` | Sign in, join, reset, admin, session (`session.ts`) |
| `api/` | `invite.ts` (validate), `signup.ts` (atomic redeem), `admin.ts` (invites, members, reset links) |
| `shared/codes.ts` | Invite code format (`XXXX-XXXX`, no 0/O/1/I) |
| `supabase/migrations/` | Schema, RLS and invite functions |
| `scripts/` | `bootstrap-admin.ts` (first admin), `make-icons.ts` |

## Local development

```bash
npm install
supabase start          # Lull's own stack on ports 554xx (doesn't clash with wellofwyrd)
cp .env.example .env.local   # fill with the keys `supabase start` prints
npm run bootstrap       # creates ADMIN_EMAIL as admin, prints a one-time password
npm run dev             # http://localhost:5190; /api runs in-process (no `vercel dev` needed)
npm test                # vitest: timer/fade copy, breathing, mixes, safe-mode maths, WAV, codes
```

In dev, `window.lull` exposes the core for poking at state.

## Lock-screen safe mode

- On by default on iPhone/iPad, and switchable under **Sounds & timer → Playback**.
- The mix is rendered offline into a seamless loop of about 2 minutes: 32 kHz stereo, around 15 MB, rendering in about 0.5 s on desktop. With Ocean on, the loop is a whole number of waves long.
- The loop plays through a plain `<audio loop>` element.
- iOS ignores `audio.volume`, so the timer fade is played as loop-length segments with the gain ramp baked in. They start from the exact loop position and are chained on `ended`.
- Slider changes re-render, debounced by 800 ms.
- In safe mode the fade is rounded to whole loops, so "Fading out" on screen can differ from the real fade by up to about 1 minute.

## Deploy (Vercel + Supabase): not done yet, needs your go-ahead

1. Create a Supabase project, then run `supabase link --project-ref <ref>` and `supabase db push`.
2. In Supabase → Auth settings:
   - disable "Allow new users to sign up"
   - set the minimum password length to 10
   - set Site URL to `https://lull.makeratl.com`
   - add `https://lull.makeratl.com/reset` to the redirect URLs
3. Create a Vercel project from this repo (framework: Vite) and set these env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN=https://lull.makeratl.com`.
4. Add the domain `lull.makeratl.com` in Vercel, and a DNS `CNAME lull → cname.vercel-dns.com` wherever makeratl.com's DNS lives.
5. Run `npm run bootstrap` against production env vars. That creates steven@makeratl.com as admin.
6. Sign in, go to **Sounds & timer → Invite & admin**, and create an invite.

## On-device test matrix (the part a desktop can't prove)

Run 1 h and 8 h with the screen locked, in both safe mode and Web Audio mode, across:
- {iOS Safari tab, iOS Home Screen app, Android Chrome installed}
- × {headband connected, headband disconnected mid-session}

Check that:
- the sound keeps going
- the timer fade happens and it stops
- lock-screen play/pause works
- the app opens in airplane mode

On Android, if sound stops overnight, set Chrome's battery usage to Unrestricted (the app says this too).

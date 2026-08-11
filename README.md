# Roll Call

A school notification system with three roles:

- **Super admin** — creates schools, disables/enables their accounts.
- **School admin** — created by the super admin, adds teachers.
- **Teacher** — creates classes (subjects), keeps a learner roster, takes
  attendance, and sends real web push notifications to a class or the whole
  school, targeted at learners, parents, or both.

Learners and parents don't need accounts. There are three levels of join
code, and anyone visiting `/join.html` and entering one turns on push
notifications for their own device — that's how real web push works: it
subscribes one specific browser, so someone has to opt in on that device.

| Code belongs to | Who uses it | What they get |
|---|---|---|
| A school | Anyone | School-wide announcements |
| A class | A learner | Updates for that subject |
| **A learner** | **That learner's parent** | **Attendance alerts for their child, plus anything the teacher sends to "parents"** |

Each learner gets their own code the moment a teacher adds them to a class
roster (visible under **My classes → [class] → roster** as "parent code").
That's the piece that makes parent-specific alerts possible — a parent's
device is linked to one specific child, not just a class.

## Attendance

Under a class's **Attendance** tab, a teacher picks a date and marks each
learner Present, Late, or Absent, then saves. Two things happen
automatically:

- The status is saved to that day's register (one record per learner, per
  class, per day — re-saving the same status doesn't do anything twice).
- Any learner **newly** marked Late or Absent triggers a push notification
  to that learner's linked parent device(s), if any are subscribed. Marking
  someone absent twice in a row doesn't send two alerts — only a genuine
  change triggers one.

Reports are downloadable as CSV, scoped to one class, for **Daily**,
**Weekly** (Monday–Sunday), or **Monthly** periods — pick any date inside
the period you want. The file has a row per attendance record plus a
per-learner summary (present/absent/late counts) at the bottom, ready to
open in Excel or Google Sheets.

## Sending notifications: learners vs. parents

When a teacher composes a notification (for a class, several classes, or
the whole school), they also choose an **audience**:

- **Learners** — reaches devices that joined with a class or school code.
- **Parents** — reaches devices that joined with a specific learner's code.
- **Both** — reaches everyone above.

So a homework reminder can go to just the class ("Learners"), an early
pickup notice can go to just parents ("Parents"), and a schedule change can
go to everyone ("Both"). Attendance alerts always go to "Parents" only and
are logged in history with an "Auto: attendance" tag so they're
distinguishable from notifications a teacher sent manually.

This is a real Node.js + PostgreSQL app, not a demo. Passwords are hashed,
push uses your own VAPID keys, and it's built to deploy on a normal host
with `lukholo.online` pointed at it.

---

## 1. Deploy on Render (recommended, simplest path)

Render gives you free managed Postgres, automatic HTTPS, and a custom
domain without touching a server yourself.

### a. Push this code to a Git repository

Create a new repo (GitHub is easiest) and push the contents of this
project (the `server/` folder and this README) to it.

### b. Create a Postgres database

1. In the Render dashboard: **New → PostgreSQL**.
2. Name it anything (e.g. `rollcall-db`). Free tier is fine to start.
3. Once created, copy the **Internal Database URL** — you'll need it next.

### c. Create the web service

1. **New → Web Service**, connect your repo.
2. **Root directory**: `server`
3. **Build command**: `npm install`
4. **Start command**: `npm start`
5. Under **Environment**, add these variables:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Internal Database URL from step (b) |
   | `DATABASE_SSL` | `true` |
   | `JWT_SECRET` | a long random string (see `.env.example` for how to generate one) |
   | `SUPER_ADMIN_EMAIL` | the email you'll use to log in as super admin |
   | `SUPER_ADMIN_PASSWORD` | a strong password |
   | `VAPID_PUBLIC_KEY` | generate in step (d) below |
   | `VAPID_PRIVATE_KEY` | generate in step (d) below |
   | `VAPID_SUBJECT` | `mailto:you@lukholo.online` |

6. Deploy. Render will build and start the app, creating the database
   tables and your super admin account automatically on first boot.

### d. Generate VAPID keys (for push)

You need a Node environment for one minute — your own machine is fine:

```bash
cd server
npm install
npx web-push generate-vapid-keys
```

Copy the public and private key it prints into the Render environment
variables above, then redeploy (or just save the env vars — Render
restarts automatically).

### e. Point lukholo.online at Render

1. In Render, open your web service → **Settings → Custom Domains** → add
   `lukholo.online` (and `www.lukholo.online` if you want both).
2. Render shows you a DNS target — usually a `CNAME` record pointing to
   something like `your-service.onrender.com`, or an `A`/`ALIAS` record for
   the root domain.
3. Go to wherever `lukholo.online`'s DNS is managed (your registrar, or
   Cloudflare if you use it) and add the record Render showed you.
4. DNS changes can take a few minutes to a few hours to propagate. Render
   automatically issues a free HTTPS certificate once it verifies the
   domain — **push notifications will not work until this is done**,
   since browsers require HTTPS for the Push API.

Once that's live, visit `https://lukholo.online`, sign in with your
`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`, and start creating schools.

---

## 2. Running it locally first (optional but recommended)

Useful to try everything before you touch DNS.

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env`:
- Point `DATABASE_URL` at a local Postgres (or a free Render/Neon/Supabase
  instance) and set `DATABASE_SSL=false` for local Postgres.
- Set `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`.
- Generate and paste in VAPID keys as in step (d) above.
- Set `JWT_SECRET` to any long random string.

```bash
npm start
```

Visit `http://localhost:3000`. Push notifications work on `localhost` even
over plain HTTP — that's a browser exception made specifically for local
development.

---

## How the pieces fit together

- **`/login.html`** — staff sign-in (super admin, school admins, teachers).
- **`/dashboard.html`** — role-aware dashboard; same page renders different
  views depending on who's signed in.
- **`/join.html`** — public page, no login. Learners/parents enter a class
  or school join code and tap "Enable notifications" to subscribe their
  device.
- **`/sw.js`** — the service worker that actually displays the push
  notification when it arrives, even if the browser tab isn't open.
- **`server/src/`** — the Express API. Routes are split by role
  (`superadmin.js`, `schooladmin.js`, `teacher.js`) plus `public.js` for
  the join/subscribe flow that needs no login.

## Notes and next steps worth knowing about

- **Temporary passwords are shown once, in the browser, after creating an
  account.** There's no email sending built in, so whoever creates a
  school or teacher account needs to relay that password to them
  (message, in person, etc). The recipient is forced to set a new
  password on first login. Adding real email delivery (e.g. via Resend or
  SendGrid) is a natural next step if you want invites sent automatically.
- **Push only reaches devices that explicitly subscribed** via
  `/join.html`. There's no way around this — it's how the Push API works
  everywhere, not a limitation specific to this app.
- **Parent subscriptions are linked to one specific learner**, via that
  learner's own join code — that's what makes attendance alerts possible.
  Class/school subscriptions stay anonymous device-level opt-ins (no name
  attached), which is deliberate: most learners and general followers
  don't need an identity in the system, only parents receiving
  child-specific alerts do.
- **A parent's device can be linked to more than one child** by visiting
  `/join.html` again with a second learner's code — each visit subscribes
  that browser to one more learner, it doesn't replace the first.
- **Attendance and notifications share the same delivery pipe.** An
  attendance alert is really just a notification with `reason: attendance`
  and `audience: parents` under the hood, so it shows up in the same
  history list a teacher already sees, just tagged differently.
- **Rotating a join code** (if one leaks or you want to reset who's
  subscribed) isn't built into the UI yet — it's a one-line addition to
  the teacher/super admin routes if you want it.

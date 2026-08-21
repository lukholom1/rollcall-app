# Roll Call

A lightweight attendance and parent-communication platform for public schools — built to bring the kind of parent-teacher communication tools private schools get from platforms like D2L, without the licensing cost.

## The idea

Private schools often run on paid platforms that keep parents in the loop automatically: attendance alerts, reminders, announcements. Public schools rarely have the budget for that. Roll Call is a scaled-down, purpose-built alternative that covers the three things that actually matter day to day:

- **Attendance** teachers can record in seconds
- **Push notifications** that reach parents and learners without needing an app store install or a phone number
- **Downloadable attendance registers** for record-keeping and compliance

No per-seat licensing, no bloated feature set — just the parts of a school communication platform that get used every day.

## Who uses it

Roll Call has three roles, each with its own dashboard:

| Role | Can do |
|---|---|
| **Super admin** | Creates and manages schools, issues one-time admin logins, can disable a school's access |
| **School admin** | Sets school branding (name + emblem shown in the header), adds/manages teaching staff |
| **Teacher** | Creates classes, adds learners, takes attendance, sends notifications, downloads reports |
| **Parent / learner** | Joins via a code (no account creation) to receive notifications for their class, school, or specific child |

Everyone below Super admin logs in with a one-time temporary password and is forced to set a permanent one on first login.

## Core features

### Attendance register
Teachers pick a class and a date, then mark each learner **Present**, **Late**, or **Absent** with a single tap. Saving attendance automatically flags parents of any learner marked absent or late, and reports back how many parents were notified.

### Push notifications
Teachers can send a notification to:
- One or more of their classes, or the entire school
- Learners, parents, or both

Parents and learners don't need a login — they join with a **code**:
- A **school join code** or **class join code** subscribes a device to that school/class's notifications
- A **parent code**, tied to a specific learner, subscribes a device to alerts about that child specifically (including automatic absence/lateness alerts)

Every notification sent is logged with scope, audience, timestamp, and how many devices received it, so teachers have a running history of what's gone out.

### Downloadable attendance reports
From the Attendance tab, teachers can export a CSV register for any class over a **daily**, **weekly**, or **monthly** period — useful for school records, compliance, or handing off to admin.

### School branding
Each school can upload a logo, which appears in the dashboard header for every user at that school, giving each school's Roll Call instance its own identity without needing separate deployments.

## How the pieces fit together

- **Schools** are created by the Super admin, each getting an admin account and a unique join code.
- **School admins** add **teachers**, each with their own one-time login.
- **Teachers** create **classes** (each with a join code) and add **learners** to them (each learner gets their own parent join code).
- **Parents/learners** register a device against a join code via a public join page — no account, no password.
- Attendance and notifications flow from teacher → learner/parent devices, scoped by class, school, or individual learner.

## Tech stack

- **Frontend:** vanilla HTML/CSS/JS (no framework — kept intentionally light)
- **Backend:** Node.js/Express REST API (`/api/...` endpoints)
- **Database:** PostgreSQL, accessed via raw parameterised queries (no ORM)
- **Auth:** JWT-style bearer tokens, verified per-request in middleware; role-gated routes (`super` / `schooladmin` / `teacher`) plus a school-status check that locks out any school the super admin has disabled
- **Push notifications:** the real Web Push API (VAPID) — devices register a browser push subscription directly, no third-party push service in the loop
- **Hosted on:** Render

### Data model (high level)

- `schools` — one row per school, with a join code and optional logo
- `users` — super admins, school admins, and teachers, scoped to a school (except super admins)
- `classes` — owned by a teacher, each with its own join code
- `learners` — belong to a class, each with a unique parent join code
- `push_subscriptions` — one row per physical device/browser (keyed by push endpoint)
- `push_targets` — what a device is subscribed to; a single device can follow multiple targets (e.g. a parent following two children, or a child plus the school's general announcements)
- `notifications` — a log of every notification sent, with scope, audience, and delivery count
- `attendance_records` — one row per learner, per class, per day, unique on that combination so a day can't be marked twice

## Status

Actively in development. Current focus areas: UI polish (glassmorphism, campus landing page), and hardening the attendance/notification flows.

## Why this matters

Public schools lose a lot of ground to private schools on parent engagement simply because the tooling is priced for institutions with bigger budgets. Roll Call's goal is to close that gap with something free or near-free to run, simple enough for any teacher to pick up in one session, and focused entirely on the communication loop that actually keeps parents informed — attendance, reminders, and nothing else bloating the experience.

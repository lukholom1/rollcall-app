CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  join_code TEXT UNIQUE NOT NULL,
  logo_data_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_data_url TEXT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('super','schooladmin','teacher')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id),
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_id TEXT NOT NULL REFERENCES users(id),
  school_id TEXT NOT NULL REFERENCES schools(id),
  join_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each learner gets their own join code so a parent can link their device
-- specifically to that child (separate from the class code, which is for
-- the learner's own device / general class following).
CREATE TABLE IF NOT EXISTS learners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  join_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE learners ADD COLUMN IF NOT EXISTS join_code TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learners_join_code_key') THEN
    ALTER TABLE learners ADD CONSTRAINT learners_join_code_key UNIQUE (join_code);
  END IF;
END $$;

-- One row per physical browser/device. A single device can only ever hold
-- one active push subscription, so this table is keyed by endpoint.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What a device is subscribed to. A device can have MANY targets - e.g. a
-- parent with two children links to both, or a parent who also follows the
-- school's general announcements. kind='learner' means "parent of this
-- specific child" (attendance alerts land here). kind='class' and
-- kind='school' mean "following this class/school's general updates".
CREATE TABLE IF NOT EXISTS push_targets (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('learner','class','school')),
  learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('class','school','learner')),
  audience TEXT NOT NULL DEFAULT 'learners' CHECK (audience IN ('learners','parents','both')),
  reason TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','attendance')),
  class_ids TEXT[] NOT NULL DEFAULT '{}',
  learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'learners';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE;

-- One row per learner, per class, per calendar day.
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late')),
  marked_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, learner_id, date)
);

const express = require("express");
const { query, pool } = require("../db");
const { id, joinCode } = require("../auth");
const { requireAuth, requireActiveSchool } = require("../middleware");
const { sendToSubscriptions } = require("../push");

const router = express.Router();
router.use(requireAuth(["teacher"]), requireActiveSchool);

// ---------- Classes ----------

router.get("/classes", async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, (SELECT count(*) FROM learners l WHERE l.class_id = c.id) AS learner_count
     FROM classes c WHERE c.teacher_id = $1 ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

router.post("/classes", async (req, res) => {
  const { name, subject } = req.body || {};
  if (!name || !subject) return res.status(400).json({ error: "Name the class and its subject." });
  const classId = id("class");
  await query(
    "INSERT INTO classes (id, name, subject, teacher_id, school_id, join_code) VALUES ($1, $2, $3, $4, $5, $6)",
    [classId, name.trim(), subject.trim(), req.user.id, req.user.schoolId, joinCode()]
  );
  const { rows } = await query("SELECT * FROM classes WHERE id = $1", [classId]);
  res.status(201).json(rows[0]);
});

async function ownedClass(req, res, next) {
  const { rows } = await query("SELECT * FROM classes WHERE id = $1 AND teacher_id = $2", [
    req.params.classId,
    req.user.id,
  ]);
  if (!rows[0]) return res.status(404).json({ error: "Class not found." });
  req.class = rows[0];
  next();
}

// ---------- Learners ----------

router.get("/classes/:classId/learners", ownedClass, async (req, res) => {
  const { rows } = await query("SELECT * FROM learners WHERE class_id = $1 ORDER BY name", [req.params.classId]);
  res.json(rows);
});

router.post("/classes/:classId/learners", ownedClass, async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Enter the learner's name." });
  const learnerId = id("learner");
  await query("INSERT INTO learners (id, name, class_id, school_id, join_code) VALUES ($1, $2, $3, $4, $5)", [
    learnerId,
    name.trim(),
    req.class.id,
    req.user.schoolId,
    joinCode(),
  ]);
  const { rows } = await query("SELECT * FROM learners WHERE id = $1", [learnerId]);
  res.status(201).json(rows[0]);
});

router.delete("/learners/:learnerId", async (req, res) => {
  await query("DELETE FROM learners WHERE id = $1 AND school_id = $2", [req.params.learnerId, req.user.schoolId]);
  res.json({ ok: true });
});

// ---------- Attendance ----------

router.get("/classes/:classId/attendance", ownedClass, async (req, res) => {
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const { rows } = await query(
    `SELECT l.id AS learner_id, l.name, a.status
     FROM learners l
     LEFT JOIN attendance_records a ON a.learner_id = l.id AND a.class_id = $1 AND a.date = $2
     WHERE l.class_id = $1 ORDER BY l.name`,
    [req.params.classId, date]
  );
  res.json({ date, roster: rows });
});

router.post("/classes/:classId/attendance", ownedClass, async (req, res) => {
  const { date, records } = req.body || {};
  const day = (date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: "No attendance records given." });
  }
  for (const r of records) {
    if (!r.learnerId || !["present", "absent", "late"].includes(r.status)) {
      return res.status(400).json({ error: "Each record needs a learner and a valid status." });
    }
  }

  const existing = await query(
    "SELECT learner_id, status FROM attendance_records WHERE class_id = $1 AND date = $2",
    [req.params.classId, day]
  );
  const previousStatus = {};
  existing.rows.forEach((r) => (previousStatus[r.learner_id] = r.status));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of records) {
      await client.query(
        `INSERT INTO attendance_records (id, class_id, learner_id, school_id, date, status, marked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (class_id, learner_id, date)
         DO UPDATE SET status = $6, updated_at = now()`,
        [id("att"), req.class.id, r.learnerId, req.user.schoolId, day, r.status, req.user.id]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Only alert parents for learners who are newly absent/late today -
  // re-saving the same status doesn't re-notify.
  const newlyFlagged = records.filter(
    (r) => (r.status === "absent" || r.status === "late") && previousStatus[r.learnerId] !== r.status
  );

  let notifiedCount = 0;
  let deliveredCount = 0;
  for (const r of newlyFlagged) {
    const learnerRes = await query("SELECT name FROM learners WHERE id = $1", [r.learnerId]);
    const learnerName = learnerRes.rows[0] ? learnerRes.rows[0].name : "Your child";
    const subsRes = await query(
      `SELECT DISTINCT s.* FROM push_subscriptions s
       JOIN push_targets t ON t.subscription_id = s.id
       WHERE t.kind = 'learner' AND t.learner_id = $1`,
      [r.learnerId]
    );
    const title = r.status === "absent" ? "Absence notice" : "Late arrival notice";
    const body = `${learnerName} was marked ${r.status} in ${req.class.name} (${req.class.subject}) on ${day}.`;
    const delivered = await sendToSubscriptions(subsRes.rows, { title, body, url: "/" });
    deliveredCount += delivered;
    notifiedCount += 1;

    await query(
      `INSERT INTO notifications (id, title, body, scope, audience, reason, class_ids, learner_id, school_id, sender_id, sender_name, recipient_count)
       VALUES ($1,$2,$3,'learner','parents','attendance',$4,$5,$6,$7,$8,$9)`,
      [id("notif"), title, body, [req.class.id], r.learnerId, req.user.schoolId, req.user.id, req.user.name, delivered]
    );
  }

  res.json({ saved: records.length, flagged: notifiedCount, delivered: deliveredCount });
});

function dateRangeFor(period, dateStr) {
  const base = dateStr || new Date().toISOString().slice(0, 10);
  const d = new Date(base + "T00:00:00Z");
  if (period === "daily") return [base, base];
  if (period === "weekly") {
    const day = d.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
  }
  if (period === "monthly") {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
  }
  return [base, base];
}

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

router.get("/classes/:classId/attendance/report", ownedClass, async (req, res) => {
  const period = ["daily", "weekly", "monthly"].includes(req.query.period) ? req.query.period : "daily";
  const [start, end] = dateRangeFor(period, req.query.date);

  const { rows } = await query(
    `SELECT a.date, l.name AS learner_name, a.status
     FROM attendance_records a JOIN learners l ON l.id = a.learner_id
     WHERE a.class_id = $1 AND a.date BETWEEN $2 AND $3
     ORDER BY a.date, l.name`,
    [req.params.classId, start, end]
  );

  const lines = [`Attendance report - ${req.class.name} (${req.class.subject})`, `${start} to ${end}`, "", "Date,Learner,Status"];
  rows.forEach((r) => {
    const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date;
    lines.push([csvEscape(dateStr), csvEscape(r.learner_name), csvEscape(r.status)].join(","));
  });

  const summary = {};
  rows.forEach((r) => {
    if (!summary[r.learner_name]) summary[r.learner_name] = { present: 0, absent: 0, late: 0 };
    summary[r.learner_name][r.status] += 1;
  });
  lines.push("", "Summary", "Learner,Present,Absent,Late");
  Object.keys(summary)
    .sort()
    .forEach((name) => {
      const s = summary[name];
      lines.push([csvEscape(name), s.present, s.absent, s.late].join(","));
    });

  const csv = lines.join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="attendance-${req.class.name.replace(/\W+/g, "-")}-${period}-${start}.csv"`);
  res.send(csv);
});

// ---------- Notifications ----------

router.post("/notifications", async (req, res) => {
  const { scope, classIds, title, body, audience } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "Add a title and a message." });
  if (!["class", "school"].includes(scope)) return res.status(400).json({ error: "Invalid scope." });
  const aud = ["learners", "parents", "both"].includes(audience) ? audience : "learners";

  let ids = [];
  if (scope === "class") {
    if (!Array.isArray(classIds) || classIds.length === 0) {
      return res.status(400).json({ error: "Choose at least one class." });
    }
    const owned = await query("SELECT id FROM classes WHERE teacher_id = $1 AND id = ANY($2)", [
      req.user.id,
      classIds,
    ]);
    ids = owned.rows.map((r) => r.id);
    if (ids.length === 0) return res.status(400).json({ error: "Choose at least one of your classes." });
  }

  let rows = [];
  if (scope === "school") {
    if (aud === "learners" || aud === "both") {
      const r = await query(
        `SELECT s.* FROM push_subscriptions s JOIN push_targets t ON t.subscription_id = s.id
         WHERE t.kind = 'school' AND t.school_id = $1`,
        [req.user.schoolId]
      );
      rows = rows.concat(r.rows);
    }
    if (aud === "parents" || aud === "both") {
      const r = await query(
        `SELECT s.* FROM push_subscriptions s JOIN push_targets t ON t.subscription_id = s.id
         WHERE t.kind = 'learner' AND t.school_id = $1`,
        [req.user.schoolId]
      );
      rows = rows.concat(r.rows);
    }
  } else {
    if (aud === "learners" || aud === "both") {
      const r = await query(
        `SELECT s.* FROM push_subscriptions s JOIN push_targets t ON t.subscription_id = s.id
         WHERE t.kind = 'class' AND t.class_id = ANY($1)`,
        [ids]
      );
      rows = rows.concat(r.rows);
    }
    if (aud === "parents" || aud === "both") {
      const r = await query(
        `SELECT s.* FROM push_subscriptions s JOIN push_targets t ON t.subscription_id = s.id
         WHERE t.kind = 'learner' AND t.class_id = ANY($1)`,
        [ids]
      );
      rows = rows.concat(r.rows);
    }
  }

  // A single device can match more than one query above (e.g. a parent who
  // also follows the school's general feed) - send to it only once.
  const seen = new Set();
  const subscriptions = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  const delivered = await sendToSubscriptions(subscriptions, { title: title.trim(), body: body.trim(), url: "/" });

  const notifId = id("notif");
  await query(
    `INSERT INTO notifications (id, title, body, scope, audience, reason, class_ids, school_id, sender_id, sender_name, recipient_count)
     VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9,$10)`,
    [notifId, title.trim(), body.trim(), scope, aud, ids, req.user.schoolId, req.user.id, req.user.name, delivered]
  );

  res.status(201).json({ id: notifId, delivered, subscribedDevices: subscriptions.length });
});

router.get("/notifications", async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM notifications WHERE sender_id = $1 ORDER BY created_at DESC LIMIT 100",
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;

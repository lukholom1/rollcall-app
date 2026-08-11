const express = require("express");
const { query } = require("../db");
const { id } = require("../auth");

const router = express.Router();

router.get("/vapid-public-key", (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// A join code can belong to a learner (parent-of-child alerts), a class
// (subject-level updates), or a whole school (school-wide announcements).
// Codes are generated from the same alphabet, so we check all three.
async function resolveCode(code) {
  const learner = await query(
    `SELECT l.id, l.name, l.class_id, l.school_id, c.name AS class_name, c.subject, s.name AS school_name, s.status
     FROM learners l JOIN classes c ON c.id = l.class_id JOIN schools s ON s.id = l.school_id
     WHERE l.join_code = $1`,
    [code]
  );
  if (learner.rows[0]) {
    const l = learner.rows[0];
    return {
      kind: "learner",
      status: l.status,
      learnerId: l.id,
      classId: l.class_id,
      schoolId: l.school_id,
      label: `Parent updates for ${l.name} · ${l.class_name} (${l.subject})`,
      schoolName: l.school_name,
    };
  }

  const cls = await query(
    `SELECT c.id, c.name, c.subject, c.school_id, s.name AS school_name, s.status
     FROM classes c JOIN schools s ON s.id = c.school_id WHERE c.join_code = $1`,
    [code]
  );
  if (cls.rows[0]) {
    const c = cls.rows[0];
    return {
      kind: "class",
      status: c.status,
      classId: c.id,
      schoolId: c.school_id,
      label: `${c.name} · ${c.subject}`,
      schoolName: c.school_name,
    };
  }

  const school = await query("SELECT id, name, status FROM schools WHERE join_code = $1", [code]);
  if (school.rows[0]) {
    const s = school.rows[0];
    return { kind: "school", status: s.status, schoolId: s.id, label: `All of ${s.name}`, schoolName: s.name };
  }

  return null;
}

router.get("/join/:code", async (req, res) => {
  const resolved = await resolveCode(req.params.code.trim().toUpperCase());
  if (!resolved) return res.status(404).json({ error: "That code doesn't match a learner, class, or school." });
  if (resolved.status !== "active") return res.status(403).json({ error: "This school's account is disabled." });
  res.json({ type: resolved.kind, id: resolved.learnerId || resolved.classId || resolved.schoolId, label: resolved.label, schoolName: resolved.schoolName });
});

router.post("/subscribe", async (req, res) => {
  const { code, subscription } = req.body || {};
  if (!code || !subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: "Missing subscription details." });
  }

  const resolved = await resolveCode(code.trim().toUpperCase());
  if (!resolved) return res.status(404).json({ error: "That code doesn't match a learner, class, or school." });
  if (resolved.status !== "active") return res.status(403).json({ error: "This school's account is disabled." });

  // One device -> one push_subscriptions row, found or created by endpoint.
  let subId;
  const existingSub = await query("SELECT id FROM push_subscriptions WHERE endpoint = $1", [subscription.endpoint]);
  if (existingSub.rows[0]) {
    subId = existingSub.rows[0].id;
    await query("UPDATE push_subscriptions SET p256dh = $1, auth = $2 WHERE id = $3", [
      subscription.keys.p256dh,
      subscription.keys.auth,
      subId,
    ]);
  } else {
    subId = id("sub");
    await query("INSERT INTO push_subscriptions (id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)", [
      subId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
    ]);
  }

  // A device can have several targets (e.g. two children). Avoid adding
  // the exact same target twice if they scan the same code again.
  const learnerId = resolved.learnerId || null;
  const classId = resolved.classId || null;
  const dup = await query(
    `SELECT id FROM push_targets
     WHERE subscription_id = $1 AND kind = $2
       AND learner_id IS NOT DISTINCT FROM $3
       AND class_id IS NOT DISTINCT FROM $4
       AND school_id = $5`,
    [subId, resolved.kind, learnerId, classId, resolved.schoolId]
  );
  if (!dup.rows[0]) {
    await query(
      "INSERT INTO push_targets (id, subscription_id, kind, learner_id, class_id, school_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [id("tgt"), subId, resolved.kind, learnerId, classId, resolved.schoolId]
    );
  }

  res.status(201).json({ ok: true, kind: resolved.kind, label: resolved.label });
});

// A device can unlink itself entirely (all targets), or just the target
// matching one code (e.g. remove one child without losing the others).
router.post("/unsubscribe", async (req, res) => {
  const { endpoint, code } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint." });
  const sub = await query("SELECT id FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
  if (!sub.rows[0]) return res.json({ ok: true });

  if (!code) {
    await query("DELETE FROM push_subscriptions WHERE id = $1", [sub.rows[0].id]);
    return res.json({ ok: true });
  }

  const resolved = await resolveCode(code.trim().toUpperCase());
  if (!resolved) return res.json({ ok: true });
  const learnerId = resolved.learnerId || null;
  const classId = resolved.classId || null;
  await query(
    `DELETE FROM push_targets
     WHERE subscription_id = $1 AND kind = $2
       AND learner_id IS NOT DISTINCT FROM $3
       AND class_id IS NOT DISTINCT FROM $4
       AND school_id = $5`,
    [sub.rows[0].id, resolved.kind, learnerId, classId, resolved.schoolId]
  );
  res.json({ ok: true });
});

module.exports = router;

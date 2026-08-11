const express = require("express");
const { query } = require("../db");
const { id, joinCode, tempPassword, hashPassword } = require("../auth");
const { requireAuth } = require("../middleware");

const router = express.Router();
router.use(requireAuth(["super"]));

router.get("/schools", async (req, res) => {
  const { rows } = await query(`
    SELECT s.*,
      (SELECT count(*) FROM users u WHERE u.school_id = s.id AND u.role = 'teacher') AS staff_count,
      (SELECT count(*) FROM classes c WHERE c.school_id = s.id) AS class_count,
      (SELECT count(*) FROM learners l WHERE l.school_id = s.id) AS learner_count,
      (SELECT json_build_object('name', u.name, 'email', u.email) FROM users u WHERE u.school_id = s.id AND u.role = 'schooladmin' LIMIT 1) AS admin
    FROM schools s ORDER BY s.created_at DESC
  `);
  res.json(rows);
});

router.post("/schools", async (req, res) => {
  const { name, adminName, adminEmail } = req.body || {};
  if (!name || !adminName || !adminEmail) {
    return res.status(400).json({ error: "Fill in the school name, admin name, and admin email." });
  }
  const email = adminEmail.trim().toLowerCase();
  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length) return res.status(409).json({ error: "That email is already in use." });

  const schoolId = id("school");
  const adminId = id("user");
  const password = tempPassword();
  const hash = await hashPassword(password);

  await query("INSERT INTO schools (id, name, status, join_code) VALUES ($1, $2, 'active', $3)", [
    schoolId,
    name.trim(),
    joinCode(),
  ]);
  await query(
    "INSERT INTO users (id, role, name, email, password_hash, school_id) VALUES ($1, 'schooladmin', $2, $3, $4, $5)",
    [adminId, adminName.trim(), email, hash, schoolId]
  );

  res.status(201).json({
    school: { id: schoolId, name: name.trim() },
    admin: { name: adminName.trim(), email, tempPassword: password },
  });
});

router.patch("/schools/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "disabled"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const { rows } = await query("UPDATE schools SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "School not found." });
  res.json(rows[0]);
});

module.exports = router;

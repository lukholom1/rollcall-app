const express = require("express");
const { query } = require("../db");
const { id, tempPassword, hashPassword } = require("../auth");
const { requireAuth, requireActiveSchool } = require("../middleware");

const router = express.Router();
router.use(requireAuth(["schooladmin"]), requireActiveSchool);

router.get("/staff", async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email,
      (SELECT count(*) FROM classes c WHERE c.teacher_id = u.id) AS class_count
     FROM users u WHERE u.school_id = $1 AND u.role = 'teacher' ORDER BY u.created_at DESC`,
    [req.user.schoolId]
  );
  res.json(rows);
});

router.post("/staff", async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: "Enter the teacher's name and email." });
  const em = email.trim().toLowerCase();
  const existing = await query("SELECT id FROM users WHERE email = $1", [em]);
  if (existing.rows.length) return res.status(409).json({ error: "That email is already in use." });

  const teacherId = id("user");
  const password = tempPassword();
  const hash = await hashPassword(password);
  await query(
    "INSERT INTO users (id, role, name, email, password_hash, school_id) VALUES ($1, 'teacher', $2, $3, $4, $5)",
    [teacherId, name.trim(), em, hash, req.user.schoolId]
  );
  res.status(201).json({ id: teacherId, name: name.trim(), email: em, tempPassword: password });
});

router.patch("/logo", async (req, res) => {
  const { logoDataUrl } = req.body || {};
  if (!logoDataUrl) return res.status(400).json({ error: "No image provided." });
  if (logoDataUrl.length > 500000) return res.status(400).json({ error: "That image is too large. Try a smaller logo." });
  await query("UPDATE schools SET logo_data_url = $1 WHERE id = $2", [logoDataUrl, req.user.schoolId]);
  res.json({ ok: true, logoDataUrl });
});

module.exports = router;

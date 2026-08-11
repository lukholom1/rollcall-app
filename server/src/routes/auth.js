const express = require("express");
const { query } = require("../db");
const { verifyPassword, hashPassword, signToken } = require("../auth");
const { requireAuth } = require("../middleware");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Enter your email and password." });

  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "No account found with that email." });

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  if (user.school_id) {
    const school = await query("SELECT status FROM schools WHERE id = $1", [user.school_id]);
    if (school.rows[0] && school.rows[0].status === "disabled") {
      return res.status(403).json({ error: "This school's account has been disabled by the super admin." });
    }
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      schoolId: user.school_id,
      mustChangePassword: user.must_change_password,
    },
  });
});

router.post("/change-password", requireAuth(), async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "Choose a password with at least 8 characters." });
  }
  const hash = await hashPassword(newPassword);
  await query("UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2", [
    hash,
    req.user.id,
  ]);
  res.json({ ok: true });
});

module.exports = router;

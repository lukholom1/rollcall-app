require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { initSchema, query } = require("./db");
const { id, hashPassword } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/superadmin", require("./routes/superadmin"));
app.use("/api/schooladmin", require("./routes/schooladmin"));
app.use("/api/teacher", require("./routes/teacher"));
app.use("/api/public", require("./routes/public"));

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => res.json({ ok: true }));

async function seedSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set - skipping super admin seed.");
    return;
  }
  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length) return;
  const hash = await hashPassword(password);
  await query(
    "INSERT INTO users (id, role, name, email, password_hash, must_change_password) VALUES ($1, 'super', 'Super Admin', $2, $3, false)",
    [id("user"), email, hash]
  );
  console.log(`Seeded super admin account: ${email}`);
}

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initSchema();
    await seedSuperAdmin();
    app.listen(PORT, () => console.log(`Roll Call server listening on port ${PORT}`));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();

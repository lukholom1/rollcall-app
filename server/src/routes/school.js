const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware");

const router = express.Router();
router.use(requireAuth(["schooladmin", "teacher"]));

router.get("/", async (req, res) => {
  const { rows } = await query("SELECT id, name, status, logo_data_url FROM schools WHERE id = $1", [
    req.user.schoolId,
  ]);
  if (!rows[0]) return res.status(404).json({ error: "School not found." });
  res.json({ id: rows[0].id, name: rows[0].name, status: rows[0].status, logoDataUrl: rows[0].logo_data_url });
});

module.exports = router;

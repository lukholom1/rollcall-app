const { verifyToken } = require("./auth");
const { query } = require("./db");

function requireAuth(roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sign in to continue." });
    try {
      const payload = verifyToken(token);
      if (roles && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Your account can't access this." });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Your session expired. Sign in again." });
    }
  };
}

// Blocks schooladmin / teacher routes if the super admin has disabled their school.
async function requireActiveSchool(req, res, next) {
  try {
    const { rows } = await query("SELECT status FROM schools WHERE id = $1", [req.user.schoolId]);
    if (!rows[0] || rows[0].status !== "active") {
      return res.status(403).json({ error: "This school's account has been disabled by the super admin." });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: "Couldn't verify school status." });
  }
}

module.exports = { requireAuth, requireActiveSchool };

// This file updates the signed-in user's profile, password, and task settings.
const express = require("express");
const bcrypt = require("bcrypt");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { deleteUploadFiles } = require("../utils/uploads");
const { deleteAccountSchema } = require("../validators/auth");
const { updateNameSchema, changePasswordSchema, updateSettingsSchema } = require("../validators/users");

const router = express.Router();
const tokenCookieName = "taskflow_token";

// Creates a shared limit for password changes and account deletion attempts.
function createSensitiveActionLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: function (request, response) {
      response.status(429).json({ error: "Too many security changes. Please try again later." });
    }
  });
}

const sensitiveActionLimiter = createSensitiveActionLimiter();
router.use(requireAuth);

// Changes the signed-in user's display name and returns safe account details.
router.patch("/me", async function (request, response) {
  const input = updateNameSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const result = await pool.query(
    "UPDATE users SET name = $2 WHERE id = $1 RETURNING id, name, email, created_at",
    [request.user.id, input.data.name]
  );
  if (!result.rows[0]) return response.status(404).json({ error: "Account not found." });
  return response.status(200).json({ user: { id: result.rows[0].id, name: result.rows[0].name, email: result.rows[0].email } });
});

// Checks the current password and replaces it with a bcrypt hash of the new password.
router.post("/me/password", sensitiveActionLimiter, async function (request, response) {
  const input = changePasswordSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const userResult = await pool.query("SELECT password_hash FROM users WHERE id = $1", [request.user.id]);
  const user = userResult.rows[0];
  if (!user) return response.status(404).json({ error: "Account not found." });
  if (!(await bcrypt.compare(input.data.currentPassword, user.password_hash))) {
    return response.status(401).json({ error: "Current password is incorrect." });
  }

  const passwordHash = await bcrypt.hash(input.data.newPassword, 12);
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [request.user.id, passwordHash]);
  return response.status(200).json({ message: "Password changed." });
});

// Deletes the account, its cascading task data, and uploaded files after password confirmation.
router.delete("/me", sensitiveActionLimiter, async function (request, response) {
  const input = deleteAccountSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const userResult = await client.query("SELECT id, password_hash FROM users WHERE id = $1 FOR UPDATE", [request.user.id]);
    const user = userResult.rows[0];
    if (!user || !(await bcrypt.compare(input.data.password, user.password_hash))) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return response.status(401).json({ error: "Password is incorrect." });
    }

    const attachmentResult = await client.query(
      `SELECT a.file_path
         FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         JOIN tasks t ON t.id = n.task_id
        WHERE t.user_id = $1`,
      [request.user.id]
    );
    await deleteUploadFiles(attachmentResult.rows.map(function (row) { return row.file_path; }));
    await client.query("DELETE FROM users WHERE id = $1", [request.user.id]);
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(function () {});
    throw error;
  } finally {
    client.release();
  }

  response.clearCookie(tokenCookieName, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return response.status(200).json({ message: "Account deleted." });
});

// Creates a default settings row when an older account does not have one yet.
async function ensureUserSettings(userId) {
  await pool.query(
    "INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );
}

// Returns the signed-in user's saved task preferences.
router.get("/me/settings", async function (request, response) {
  await ensureUserSettings(request.user.id);
  const result = await pool.query(
    `SELECT default_priority AS "defaultPriority", show_completed_tasks AS "showCompletedTasks"
       FROM user_settings WHERE user_id = $1`,
    [request.user.id]
  );
  return response.status(200).json({ settings: result.rows[0] });
});

// Updates only the preference fields included in the request.
router.patch("/me/settings", async function (request, response) {
  const input = updateSettingsSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const settings = input.data;
  const result = await pool.query(
    `INSERT INTO user_settings (user_id, default_priority, show_completed_tasks)
     VALUES ($1, COALESCE($2::text, 'medium'), COALESCE($3::boolean, TRUE))
     ON CONFLICT (user_id) DO UPDATE SET
       default_priority = CASE WHEN $4::boolean THEN EXCLUDED.default_priority ELSE user_settings.default_priority END,
       show_completed_tasks = CASE WHEN $5::boolean THEN EXCLUDED.show_completed_tasks ELSE user_settings.show_completed_tasks END,
       updated_at = NOW()
     RETURNING default_priority AS "defaultPriority", show_completed_tasks AS "showCompletedTasks"`,
    [request.user.id, settings.defaultPriority || null, settings.showCompletedTasks == null ? null : settings.showCompletedTasks,
      settings.defaultPriority !== undefined, settings.showCompletedTasks !== undefined]
  );
  return response.status(200).json({ settings: result.rows[0] });
});

module.exports = router;

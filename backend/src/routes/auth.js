// This file provides registration, login, logout, and current-user endpoints.
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { deleteUploadFiles } = require("../utils/uploads");
const { registerSchema, loginSchema, deleteAccountSchema } = require("../validators/auth");

const router = express.Router();
const tokenCookieName = "taskflow_token";
const tokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;

// Creates a login/register limiter so repeated attempts are slowed down.
function createAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: function (request, response) {
      response.status(429).json({ error: "Too many attempts. Please try again later." });
    }
  });
}

const authLimiter = createAuthLimiter();

// Slows repeated account-deletion password attempts on the older auth endpoint.
const accountDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function (request, response) {
    response.status(429).json({ error: "Too many security changes. Please try again later." });
  }
});

// Reads the signing key and refuses the example placeholder value.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.startsWith("replace_with_")) {
    throw new Error("Set JWT_SECRET to a private random value in backend/.env.");
  }
  return secret;
}

// Creates the secure browser cookie containing a signed login token.
function setLoginCookie(response, token) {
  response.cookie(tokenCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: tokenLifetimeMs,
    path: "/"
  });
}

// Sends safe account details without the password hash.
function sendUser(response, statusCode, user) {
  response.status(statusCode).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.created_at
    }
  });
}

// Registers an account, hashes its password, and starts a login session.
router.post("/register", authLimiter, async function (request, response) {
  const result = registerSchema.safeParse(request.body);
  if (!result.success) {
    return response.status(400).json({ error: result.error.issues[0].message });
  }

  const name = result.data.name;
  const email = result.data.email.toLowerCase();
  const jwtSecret = getJwtSecret();
  const passwordHash = await bcrypt.hash(result.data.password, 12);

  try {
    const query = "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at";
    const databaseResult = await pool.query(query, [name, email, passwordHash]);
    const user = databaseResult.rows[0];
    const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: "7d" });
    setLoginCookie(response, token);
    return sendUser(response, 201, user);
  } catch (error) {
    if (error.code === "23505") {
      return response.status(409).json({ error: "An account with this email already exists." });
    }
    throw error;
  }
});

// Checks credentials with one generic message and starts a login session.
router.post("/login", authLimiter, async function (request, response) {
  const result = loginSchema.safeParse(request.body);
  if (!result.success) {
    return response.status(400).json({ error: result.error.issues[0].message });
  }

  const email = result.data.email.toLowerCase();
  const databaseResult = await pool.query(
    "SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1",
    [email]
  );
  const user = databaseResult.rows[0];
  const passwordMatches = user ? await bcrypt.compare(result.data.password, user.password_hash) : false;

  if (!passwordMatches) {
    return response.status(401).json({ error: "Email or password is incorrect" });
  }

  const token = jwt.sign({ id: user.id }, getJwtSecret(), { expiresIn: "7d" });
  setLoginCookie(response, token);
  return sendUser(response, 200, user);
});

// Clears the browser session cookie to log the user out.
router.post("/logout", function (request, response) {
  response.clearCookie(tokenCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  response.status(200).json({ message: "Logged out" });
});

// Deletes the signed-in user's account after confirming the password and removes its images.
router.delete("/me", accountDeleteLimiter, requireAuth, async function (request, response) {
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

    await client.query("SELECT id FROM tasks WHERE user_id = $1 FOR UPDATE", [request.user.id]);
    const attachments = await client.query(
      `SELECT a.file_path FROM note_attachments a
       JOIN notes n ON n.id = a.note_id
       JOIN tasks t ON t.id = n.task_id
       WHERE t.user_id = $1`,
      [request.user.id]
    );
    await deleteUploadFiles(attachments.rows.map(function (row) { return row.file_path; }));
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

// Reads the login cookie and returns the current account if it is valid.
router.get("/me", async function (request, response) {
  const token = request.cookies[tokenCookieName];
  if (!token) {
    return response.status(401).json({ error: "You must log in first." });
  }

  let tokenData;
  try {
    tokenData = jwt.verify(token, getJwtSecret());
  } catch (error) {
    return response.status(401).json({ error: "You must log in first." });
  }

  const databaseResult = await pool.query(
    "SELECT id, name, email, created_at FROM users WHERE id = $1",
    [tokenData.id]
  );
  if (!databaseResult.rows[0]) {
    return response.status(401).json({ error: "You must log in first." });
  }

  return sendUser(response, 200, databaseResult.rows[0]);
});

module.exports = router;

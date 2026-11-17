// This middleware verifies the login cookie and exposes its user id to routes.
const jwt = require("jsonwebtoken");

// Stops requests without a valid signed-in user before protected routes run.
function requireAuth(request, response, next) {
  const token = request.cookies.taskflow_token;
  if (!token) {
    return response.status(401).json({ error: "You must log in first." });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.startsWith("replace_with_")) {
      return response.status(500).json({ error: "Authentication is not configured." });
    }
    const tokenData = jwt.verify(token, secret);
    request.user = { id: tokenData.id };
    return next();
  } catch (error) {
    return response.status(401).json({ error: "You must log in first." });
  }
}

module.exports = requireAuth;

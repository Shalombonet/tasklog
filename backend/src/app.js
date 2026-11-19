// This file creates the Express app and connects shared middleware and API routes.
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("path");
const authRoutes = require("./routes/auth");
const attachmentRoutes = require("./routes/attachments");
const taskRoutes = require("./routes/tasks");
const aiRoutes = require("./routes/ai");
const projectRoutes = require("./routes/projects");
const statsRoutes = require("./routes/stats");
const userRoutes = require("./routes/users");
const notificationRoutes = require("./routes/notifications");
const pool = require("./db/pool");
const { notFound, errorHandler } = require("./middleware/errors");
const frontendRoot = path.resolve(__dirname, "../..");
const frontendFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/login.html": "login.html",
  "/register.html": "register.html",
  "/style.css": "style.css",
  "/app.js": "app.js",
  "/favicon.svg": "favicon.svg"
};

// Creates the Express app with the first API and account routes.
function createApp() {
  const app = express();

  // Trust the single proxy in front of this app on Render.
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", "blob:"] } } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Checks that both the web server and its PostgreSQL connection are ready.
  app.get("/api/health", async function (request, response) {
    try {
      await pool.query("SELECT 1");
      return response.status(200).json({ status: "ok" });
    } catch (error) {
      return response.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/stats", statsRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/attachments", attachmentRoutes);

  // Serves only the known frontend files from the project root, never backend secrets.
  app.get(Object.keys(frontendFiles), function (request, response, next) {
    response.sendFile(frontendFiles[request.path], { root: frontendRoot }, function (error) {
      if (error) next(error);
    });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;

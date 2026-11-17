// This file serves private note images only to their owning signed-in user.
const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { taskIdSchema } = require("../validators/tasks");
const { getUploadDetails } = require("../utils/uploads");

const router = express.Router();

// Validates an attachment id and checks its owning task before sending its image.
router.get("/:id", requireAuth, async function (request, response, next) {
  const parsedId = taskIdSchema.safeParse(request.params.id);
  if (!parsedId.success) return response.status(400).json({ error: "Attachment id must be a positive integer." });

  const result = await pool.query(
    `SELECT a.file_path
       FROM note_attachments a
       JOIN notes n ON n.id = a.note_id
       JOIN tasks t ON t.id = n.task_id
      WHERE a.id = $1 AND t.user_id = $2`,
    [parsedId.data, request.user.id]
  );
  if (!result.rows[0]) return response.status(404).json({ error: "Attachment not found." });

  let upload;
  try {
    upload = getUploadDetails(result.rows[0].file_path);
  } catch (error) {
    return next(error);
  }
  response.type(upload.mimeType);
  response.set("Cache-Control", "private, no-store");
  response.set("Content-Disposition", "inline");
  response.sendFile(upload.absolutePath, function (error) {
    if (!error) return;
    if (error.code === "ENOENT") return response.status(404).json({ error: "Attachment file is missing." });
    return next(error);
  });
});

module.exports = router;

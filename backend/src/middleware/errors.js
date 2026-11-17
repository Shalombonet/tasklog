// This file returns consistent JSON for unknown routes and upload failures.
const multer = require("multer");

// Returns JSON when a client requests a route that does not exist.
function notFound(request, response) {
  response.status(404).json({ error: "Route not found" });
}

// Converts thrown route errors into safe, user-readable JSON responses.
function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  if (error.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return response.status(400).json({ error: "Each image must be 5 MB or smaller." });
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_PART_COUNT") return response.status(400).json({ error: "Upload no more than 5 images at a time." });
    if (error.code === "LIMIT_UNEXPECTED_FILE") return response.status(400).json({ error: "Use the images field and upload no more than 5 files." });
    if (error.code === "LIMIT_FIELD_COUNT" || error.code === "LIMIT_FIELD_KEY") return response.status(400).json({ error: "Unexpected upload form field." });
    return response.status(400).json({ error: "The image upload could not be read." });
  }

  if (error.code === "INVALID_IMAGE_TYPE") {
    return response.status(400).json({ error: error.message });
  }

  console.error(error.message);
  return response.status(500).json({ error: "Internal server error" });
}

module.exports = { notFound, errorHandler };

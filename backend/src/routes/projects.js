// This file lists and changes projects owned by the signed-in user.
const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { deleteUploadFiles } = require("../utils/uploads");
const { projectIdSchema, createProjectSchema, updateProjectSchema } = require("../validators/projects");

const router = express.Router();
router.use(requireAuth);

// Ignores a rollback failure while the original database error is being returned.
function ignoreRollbackError() {}

// Parses a project id and returns a clear validation error for invalid values.
function parseProjectId(value, response) {
  const parsed = projectIdSchema.safeParse(value);
  if (!parsed.success) {
    response.status(400).json({ error: "Project id must be a positive integer." });
    return null;
  }
  return parsed.data;
}

// Lists each owned project with task totals and completed task totals.
router.get("/", async function (request, response) {
  const result = await pool.query(
    `SELECT p.id, p.name, p.color, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
            COUNT(t.id)::int AS "taskCount",
            COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS "completedCount"
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.created_at, p.id`,
    [request.user.id]
  );
  return response.status(200).json({ projects: result.rows });
});

// Creates one project for the signed-in user.
router.post("/", async function (request, response) {
  const input = createProjectSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  try {
    const result = await pool.query(
      `INSERT INTO projects (user_id, name, color)
       VALUES ($1, $2, $3)
       RETURNING id, name, color, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [request.user.id, input.data.name, input.data.color]
    );
    return response.status(201).json({ project: { ...result.rows[0], taskCount: 0, completedCount: 0 } });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "A project with that name already exists." });
    throw error;
  }
});

// Renames or recolors one project only when it belongs to the signed-in user.
router.patch("/:id", async function (request, response) {
  const projectId = parseProjectId(request.params.id, response);
  if (projectId == null) return;
  const input = updateProjectSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  try {
    const result = await pool.query(
      `UPDATE projects SET
         name = CASE WHEN $3::boolean THEN $4::text ELSE name END,
         color = CASE WHEN $5::boolean THEN $6::text ELSE color END,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, color, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [projectId, request.user.id,
        input.data.name !== undefined, input.data.name,
        input.data.color !== undefined, input.data.color]
    );
    if (!result.rows[0]) return response.status(404).json({ error: "Project not found." });
    return response.status(200).json({ project: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "A project with that name already exists." });
    throw error;
  }
});

// Deletes an owned project, its tasks, and any attachment files for those tasks.
router.delete("/:id", async function (request, response) {
  const projectId = parseProjectId(request.params.id, response);
  if (projectId == null) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(
      "SELECT id FROM projects WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [projectId, request.user.id]
    );
    if (!project.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Project not found." });
    }

    const attachments = await client.query(
      `SELECT a.file_path
         FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         JOIN tasks t ON t.id = n.task_id
        WHERE t.project_id = $1 AND t.user_id = $2`,
      [projectId, request.user.id]
    );
    const taskCount = await client.query(
      "SELECT COUNT(*)::int AS total FROM tasks WHERE project_id = $1 AND user_id = $2",
      [projectId, request.user.id]
    );
    const attachmentPaths = [];
    for (const row of attachments.rows) attachmentPaths.push(row.file_path);
    await deleteUploadFiles(attachmentPaths);
    await client.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, request.user.id]);
    await client.query("COMMIT");
    return response.status(200).json({ message: "Project deleted.", tasksDeleted: taskCount.rows[0].total });
  } catch (error) {
    await client.query("ROLLBACK").catch(ignoreRollbackError);
    throw error;
  } finally {
    client.release();
  }
});

module.exports = router;

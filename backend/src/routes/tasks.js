// This file implements task listing, creation, reading, editing, and deletion.
const express = require("express");
const multer = require("multer");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { saveUploadedImages, deleteUploadFiles } = require("../utils/uploads");
const { taskIdSchema, createTaskSchema, updateTaskSchema, addStepSchema, updateStepSchema, createNoteSchema, listTasksQuerySchema } = require("../validators/tasks");

const router = express.Router();
const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 0, parts: 5 }
}).array("images", 5);

// Reads one task and its related lists, always checking that it belongs to the user.
async function getTaskById(userId, taskId, database = pool) {
  const query = `
    SELECT
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.due_date::text AS "dueDate",
      t.project_id AS "projectId",
      p.name AS "projectName",
      p.color AS "projectColor",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id, 'text', s.text, 'done', s.done, 'source', s.source, 'position', s.position
        ) ORDER BY s.position, s.id)
        FROM steps s WHERE s.task_id = t.id
      ), '[]'::json) AS steps,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', n.id, 'text', n.text, 'createdAt', n.created_at,
          'attachments', COALESCE((
            SELECT json_agg(json_build_object(
              'id', a.id, 'name', a.file_name, 'url', '/api/attachments/' || a.id::text
            ) ORDER BY a.id)
            FROM note_attachments a WHERE a.note_id = n.id
          ), '[]'::json)
        ) ORDER BY n.created_at DESC, n.id DESC)
        FROM notes n WHERE n.task_id = t.id
      ), '[]'::json) AS notes,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', h.id, 'text', h.text, 'createdAt', h.created_at
        ) ORDER BY h.created_at DESC, h.id DESC)
        FROM history h WHERE h.task_id = t.id
      ), '[]'::json) AS history
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.user_id = t.user_id
    WHERE t.id = $1 AND t.user_id = $2
  `;
  const result = await database.query(query, [taskId, userId]);
  return result.rows[0] || null;
}

// Parses a URL id and sends a clear validation error when it is invalid.
function parseTaskId(value, response, label) {
  const result = taskIdSchema.safeParse(value);
  if (!result.success) {
    response.status(400).json({ error: (label || "Task") + " id must be a positive integer." });
    return null;
  }
  return result.data;
}

// Validates task and note ids and confirms ownership before accepting image data.
async function validateNoteAttachmentTarget(request, response, next) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const noteId = parseTaskId(request.params.noteId, response, "Note");
  if (noteId == null) return;
  const result = await pool.query(
    `SELECT n.id
       FROM notes n
       JOIN tasks t ON t.id = n.task_id
      WHERE t.id = $1 AND n.id = $2 AND t.user_id = $3`,
    [taskId, noteId, request.user.id]
  );
  if (!result.rows[0]) return response.status(404).json({ error: "Note not found." });
  request.attachmentTaskId = taskId;
  request.attachmentNoteId = noteId;
  return next();
}

// Locks a task only when it belongs to the signed-in user.
async function getOwnedTaskForUpdate(client, userId, taskId) {
  const result = await client.query(
    "SELECT id, status, due_date FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE",
    [taskId, userId]
  );
  return result.rows[0] || null;
}

// Adds history only if the task is owned by the signed-in user.
async function addTaskHistory(client, userId, taskId, text) {
  await client.query(
    "INSERT INTO history (task_id, text) SELECT id, $3 FROM tasks WHERE id = $1 AND user_id = $2",
    [taskId, userId, text]
  );
}

// Recalculates a task's status after its checklist changes and records status history.
async function updateStatusAfterStepChange(client, userId, task, mode) {
  const countResult = await client.query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE done)::int AS done FROM steps WHERE task_id = $1 AND EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2)",
    [task.id, userId]
  );
  const total = countResult.rows[0].total;
  const done = countResult.rows[0].done;
  let nextStatus = task.status;

  if (mode === "add" && task.status === "completed") {
    nextStatus = "in_progress";
  } else if (total > 0 && done === total) {
    nextStatus = "completed";
  } else if ((mode === "untick" || mode === "add") && task.status === "completed") {
    nextStatus = "in_progress";
  } else if (done > 0 && task.status === "pending") {
    nextStatus = "in_progress";
  } else if (mode === "untick" && done === 0 && task.status === "in_progress") {
    nextStatus = "pending";
  }

  if (nextStatus === task.status) return;
  await client.query("UPDATE tasks SET status = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2", [task.id, userId, nextStatus]);
  let historyText = "Status changed to " + nextStatus;
  if (nextStatus === "in_progress") historyText = "Started working on this task";
  if (nextStatus === "pending") historyText = "Moved back to To do";
  if (nextStatus === "completed") historyText = "All steps done, task completed";
  await addTaskHistory(client, userId, task.id, historyText);
}

router.use(requireAuth);

// Uploads up to five verified images and links them to an owned note.
router.post("/:id/notes/:noteId/attachments", validateNoteAttachmentTarget, uploadImages, async function (request, response) {
  if (!request.files || request.files.length === 0) {
    return response.status(400).json({ error: "Choose at least one image to upload." });
  }

  let savedFiles = [];
  let client;
  let transactionStarted = false;
  try {
    savedFiles = await saveUploadedImages(request.files);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const task = await getOwnedTaskForUpdate(client, request.user.id, request.attachmentTaskId);
    const target = task && await client.query(
      "SELECT id FROM notes WHERE id = $1 AND task_id = $2 FOR UPDATE",
      [request.attachmentNoteId, request.attachmentTaskId]
    );
    if (!target || !target.rows[0]) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      await deleteUploadFiles(savedFiles.map(function (file) { return file.filePath; }));
      savedFiles = [];
      return response.status(404).json({ error: "Note not found." });
    }

    const attachments = [];
    for (const file of savedFiles) {
      const result = await client.query(
        `INSERT INTO note_attachments (note_id, file_name, file_path)
         SELECT n.id, $3, $4 FROM notes n
         JOIN tasks t ON t.id = n.task_id
         WHERE n.id = $1 AND t.id = $2 AND t.user_id = $5
         RETURNING id`,
        [request.attachmentNoteId, request.attachmentTaskId, file.fileName, file.filePath, request.user.id]
      );
      attachments.push({ id: result.rows[0].id, name: file.fileName, url: "/api/attachments/" + result.rows[0].id });
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return response.status(201).json({ attachments: attachments });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK").catch(function () {});
    if (savedFiles.length) {
      await Promise.allSettled([deleteUploadFiles(savedFiles.map(function (file) { return file.filePath; }))]);
    }
    throw error;
  } finally {
    if (client) client.release();
  }
});

// Deletes an attachment only when its note and task belong to the signed-in user.
router.delete("/:id/notes/:noteId/attachments/:attachmentId", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const noteId = parseTaskId(request.params.noteId, response, "Note");
  if (noteId == null) return;
  const attachmentId = parseTaskId(request.params.attachmentId, response, "Attachment");
  if (attachmentId == null) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Attachment not found." });
    }
    const result = await client.query(
      `SELECT a.file_path
         FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
        WHERE a.id = $1 AND n.id = $2 AND n.task_id = $3
        FOR UPDATE OF a`,
      [attachmentId, noteId, taskId]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Attachment not found." });
    }
    await deleteUploadFiles([result.rows[0].file_path]);
    await client.query("DELETE FROM note_attachments WHERE id = $1", [attachmentId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return response.status(200).json({ message: "Attachment deleted." });
});

// Lists the signed-in user's tasks with optional status, priority, project, text, and due-date filters.
router.get("/", async function (request, response) {
  const filters = listTasksQuerySchema.safeParse(request.query);
  if (!filters.success) {
    return response.status(400).json({ error: filters.error.issues[0].message });
  }
  const status = filters.data.status || null;
  const priority = filters.data.priority || null;
  const search = filters.data.search || null;
  const projectId = filters.data.projectId;
  const fromDate = filters.data.from || null;
  const toDate = filters.data.to || null;
  const query = `
    SELECT t.id
    FROM tasks t
    WHERE t.user_id = $1
      AND ($2::text IS NULL OR t.status = $2)
      AND ($3::text IS NULL OR t.priority = $3)
      AND ($4::text IS NULL OR t.title ILIKE '%' || $4 || '%' OR t.description ILIKE '%' || $4 || '%')
      AND ($5::text IS NULL OR ($5 = 'inbox' AND t.project_id IS NULL) OR ($5 <> 'inbox' AND t.project_id = $6::int))
      AND ($7::date IS NULL OR t.due_date >= $7::date)
      AND ($8::date IS NULL OR t.due_date <= $8::date)
    ORDER BY t.created_at DESC, t.id DESC
  `;
  const result = await pool.query(query, [request.user.id, status, priority, search, projectId == null ? null : String(projectId), typeof projectId === "number" ? projectId : null, fromDate, toDate]);
  const taskList = [];
  for (const row of result.rows) {
    const task = await getTaskById(request.user.id, row.id);
    if (task) taskList.push(task);
  }
  return response.status(200).json({ tasks: taskList });
});

// Creates a task and its optional checklist and initial history in one transaction.
router.post("/", async function (request, response) {
  const input = createTaskSchema.safeParse(request.body);
  if (!input.success) {
    return response.status(400).json({ error: input.error.issues[0].message });
  }

  const client = await pool.connect();
  let taskId;
  try {
    await client.query("BEGIN");
    const taskResult = await client.query(
      `INSERT INTO tasks (user_id, title, description, priority, due_date, project_id)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE $6::int IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id = $6 AND user_id = $1)
       RETURNING id`,
      [request.user.id, input.data.title, input.data.description || "", input.data.priority || "medium", input.data.dueDate || null, input.data.projectId == null ? null : input.data.projectId]
    );
    if (!taskResult.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Project not found." });
    }
    taskId = taskResult.rows[0].id;

    const steps = input.data.steps || [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      await client.query(
        "INSERT INTO steps (task_id, text, source, position) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND user_id = $5)",
        [taskId, step.text, step.source || "user", step.position == null ? index : step.position, request.user.id]
      );
    }
    await addTaskHistory(client, request.user.id, taskId, "Task created");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const task = await getTaskById(request.user.id, taskId);
  return response.status(201).json({ task: task });
});

// Returns one task only when it belongs to the signed-in user.
router.get("/:id", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const task = await getTaskById(request.user.id, taskId);
  if (!task) return response.status(404).json({ error: "Task not found." });
  return response.status(200).json({ task: task });
});

// Applies a partial task update and records a history entry for status changes.
router.patch("/:id", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const input = updateTaskSchema.safeParse(request.body);
  if (!input.success) {
    return response.status(400).json({ error: input.error.issues[0].message });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT status, due_date FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [taskId, request.user.id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }

    if (input.data.projectId != null) {
      const projectResult = await client.query(
        "SELECT id FROM projects WHERE id = $1 AND user_id = $2 FOR KEY SHARE",
        [input.data.projectId, request.user.id]
      );
      if (!projectResult.rows[0]) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Project not found." });
      }
    }

    const fields = input.data;
    await client.query(
      `UPDATE tasks SET
        title = CASE WHEN $3::boolean THEN $4::text ELSE title END,
        description = CASE WHEN $5::boolean THEN $6::text ELSE description END,
        status = CASE WHEN $7::boolean THEN $8::text ELSE status END,
        priority = CASE WHEN $9::boolean THEN $10::text ELSE priority END,
        due_date = CASE WHEN $11::boolean THEN $12::date ELSE due_date END,
        project_id = CASE WHEN $13::boolean THEN $14::int ELSE project_id END,
        updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [taskId, request.user.id,
        fields.title !== undefined, fields.title,
        fields.description !== undefined, fields.description,
        fields.status !== undefined, fields.status || null,
        fields.priority !== undefined, fields.priority || null,
        fields.dueDate !== undefined, fields.dueDate || null,
        fields.projectId !== undefined, fields.projectId]
    );

    if (fields.status && fields.status !== current.status) {
      let historyText = "Status changed to " + fields.status;
      if (fields.status === "in_progress") historyText = "Started working on this task";
      if (fields.status === "pending") historyText = "Moved back to To do";
      if (fields.status === "completed") {
        const deadline = fields.dueDate === undefined ? current.due_date : fields.dueDate;
        const deadlineText = deadline && new Date(deadline).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        historyText = deadlineText && deadlineText > today ? "Marked as done before the deadline" : "Marked as done";
      }
      await addTaskHistory(client, request.user.id, taskId, historyText);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const task = await getTaskById(request.user.id, taskId);
  return response.status(200).json({ task: task });
});

// Deletes one task only when it belongs to the signed-in user.
router.delete("/:id", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const client = await pool.connect();
  let attachmentPaths = [];
  try {
    await client.query("BEGIN");
    const task = await client.query("SELECT id FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE", [taskId, request.user.id]);
    if (!task.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const attachments = await client.query(
      `SELECT a.file_path FROM note_attachments a
       JOIN notes n ON n.id = a.note_id
       JOIN tasks t ON t.id = n.task_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [taskId, request.user.id]
    );
    attachmentPaths = attachments.rows.map(function (row) { return row.file_path; });
    await deleteUploadFiles(attachmentPaths);
    await client.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [taskId, request.user.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return response.status(200).json({ message: "Task deleted" });
});

// Adds a checklist step and reopens a completed task if new work is added.
router.post("/:id/steps", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const input = addStepSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const positionResult = await client.query(
      "SELECT COUNT(*)::int AS total FROM steps WHERE task_id = $1 AND EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2)",
      [taskId, request.user.id]
    );
    await client.query(
      "INSERT INTO steps (task_id, text, source, position) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND user_id = $5)",
      [taskId, input.data.text, input.data.source || "user", input.data.position == null ? positionResult.rows[0].total : input.data.position, request.user.id]
    );
    await addTaskHistory(client, request.user.id, taskId, "Added step: " + input.data.text);
    await updateStatusAfterStepChange(client, request.user.id, task, "add");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updatedTask = await getTaskById(request.user.id, taskId);
  return response.status(201).json({ task: updatedTask });
});

// Edits one checklist step and keeps task status and history in sync with its checkboxes.
router.patch("/:id/steps/:stepId", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const stepId = parseTaskId(request.params.stepId, response, "Step");
  if (stepId == null) return;
  const input = updateStepSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const stepResult = await client.query(
      "SELECT s.id, s.text, s.done FROM steps s JOIN tasks t ON t.id = s.task_id WHERE s.id = $1 AND s.task_id = $2 AND t.user_id = $3 FOR UPDATE OF s",
      [stepId, taskId, request.user.id]
    );
    const step = stepResult.rows[0];
    if (!step) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Step not found." });
    }

    const fields = input.data;
    const updatedText = fields.text === undefined ? step.text : fields.text;
    await client.query(
      "UPDATE steps SET text = CASE WHEN $4::boolean THEN $5::text ELSE text END, done = CASE WHEN $6::boolean THEN $7::boolean ELSE done END, position = CASE WHEN $8::boolean THEN $9::int ELSE position END WHERE id = $1 AND task_id = $2 AND EXISTS (SELECT 1 FROM tasks WHERE id = $2 AND user_id = $3)",
      [stepId, taskId, request.user.id, fields.text !== undefined, fields.text, fields.done !== undefined, fields.done, fields.position !== undefined, fields.position]
    );

    if (fields.done !== undefined && fields.done !== step.done) {
      await addTaskHistory(client, request.user.id, taskId, (fields.done ? "Completed step: " : "Unticked step: ") + updatedText);
    } else if (fields.text !== undefined && fields.text !== step.text) {
      await addTaskHistory(client, request.user.id, taskId, "Updated step: " + updatedText);
    }
    const mode = fields.done === false && step.done ? "untick" : "update";
    await updateStatusAfterStepChange(client, request.user.id, task, mode);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updatedTask = await getTaskById(request.user.id, taskId);
  return response.status(200).json({ task: updatedTask });
});

// Deletes one checklist step and records the removal in the task history.
router.delete("/:id/steps/:stepId", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const stepId = parseTaskId(request.params.stepId, response, "Step");
  if (stepId == null) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const result = await client.query(
      "DELETE FROM steps s USING tasks t WHERE s.id = $1 AND s.task_id = $2 AND t.id = s.task_id AND t.user_id = $3 RETURNING s.text",
      [stepId, taskId, request.user.id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Step not found." });
    }
    await addTaskHistory(client, request.user.id, taskId, "Deleted step: " + result.rows[0].text);
    await updateStatusAfterStepChange(client, request.user.id, task, "delete");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updatedTask = await getTaskById(request.user.id, taskId);
  return response.status(200).json({ task: updatedTask });
});

// Adds a timestamped note to a task and records the action in its history.
router.post("/:id/notes", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const input = createNoteSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const client = await pool.connect();
  let noteId;
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const result = await client.query(
      "INSERT INTO notes (task_id, text) SELECT id, $2 FROM tasks WHERE id = $1 AND user_id = $3 RETURNING id",
      [taskId, input.data.text, request.user.id]
    );
    noteId = result.rows[0].id;
    await addTaskHistory(client, request.user.id, taskId, "Added a note");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updatedTask = await getTaskById(request.user.id, taskId);
  const note = updatedTask.notes.find(function (item) { return item.id === noteId; });
  return response.status(201).json({ note: note, task: updatedTask });
});

// Deletes a note only when its task belongs to the signed-in user.
router.delete("/:id/notes/:noteId", async function (request, response) {
  const taskId = parseTaskId(request.params.id, response);
  if (taskId == null) return;
  const noteId = parseTaskId(request.params.noteId, response, "Note");
  if (noteId == null) return;

  const client = await pool.connect();
  let attachmentPaths = [];
  try {
    await client.query("BEGIN");
    const task = await getOwnedTaskForUpdate(client, request.user.id, taskId);
    if (!task) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Task not found." });
    }
    const attachments = await client.query(
      `SELECT a.file_path FROM note_attachments a
       JOIN notes n ON n.id = a.note_id
       JOIN tasks t ON t.id = n.task_id
       WHERE n.id = $1 AND t.id = $2 AND t.user_id = $3`,
      [noteId, taskId, request.user.id]
    );
    attachmentPaths = attachments.rows.map(function (row) { return row.file_path; });
    await deleteUploadFiles(attachmentPaths);
    const result = await client.query(
      "DELETE FROM notes n USING tasks t WHERE n.id = $1 AND n.task_id = $2 AND t.id = n.task_id AND t.user_id = $3 RETURNING n.id",
      [noteId, taskId, request.user.id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Note not found." });
    }
    await addTaskHistory(client, request.user.id, taskId, "Deleted a note");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return response.status(200).json({ message: "Note deleted" });
});

module.exports = router;

// This file returns SQL summaries, daily activity, and completion streaks for the signed-in user.
const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");
const { projectFilterSchema, activityQuerySchema } = require("../validators/stats");

const router = express.Router();
router.use(requireAuth);

// Reads and validates the optional project filter shared by the summary endpoint.
function getProjectFilter(value, response) {
  const result = projectFilterSchema.safeParse(value);
  if (!result.success) {
    response.status(400).json({ error: "Choose Inbox or a valid project id." });
    return null;
  }
  return { value: result.data == null ? null : String(result.data), id: typeof result.data === "number" ? result.data : null };
}

// Returns task totals and due-date counts using one database aggregation.
router.get("/summary", async function (request, response) {
  const projectFilter = getProjectFilter(request.query.projectId, response);
  if (!projectFilter) return;

  const result = await pool.query(
    `WITH selected_tasks AS (
       SELECT id, status, due_date
         FROM tasks
        WHERE user_id = $1
          AND ($2::text IS NULL OR ($2 = 'inbox' AND project_id IS NULL) OR ($2 <> 'inbox' AND project_id = $3::int))
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE status <> 'completed' AND due_date < CURRENT_DATE)::int AS overdue,
            COUNT(*) FILTER (WHERE status <> 'completed' AND due_date = CURRENT_DATE)::int AS "dueToday",
            COUNT(*) FILTER (
              WHERE status <> 'completed'
                AND due_date >= date_trunc('week', CURRENT_DATE)::date
                AND due_date < (date_trunc('week', CURRENT_DATE) + INTERVAL '1 week')::date
            )::int AS "dueThisWeek",
            COALESCE((
              SELECT COUNT(DISTINCT h.task_id)::int
                FROM history h
                JOIN tasks completed_task ON completed_task.id = h.task_id
               WHERE completed_task.user_id = $1
                 AND h.text IN ('Marked as done', 'Marked as done before the deadline', 'All steps done, task completed')
                 AND h.created_at >= date_trunc('week', CURRENT_DATE)
                 AND h.created_at < date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
                 AND ($2::text IS NULL OR ($2 = 'inbox' AND completed_task.project_id IS NULL) OR ($2 <> 'inbox' AND completed_task.project_id = $3::int))
            ), 0)::int AS "completedThisWeek",
            COALESCE(ROUND(COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / NULLIF(COUNT(*), 0))::int, 0) AS "completionRate"
       FROM selected_tasks`,
    [request.user.id, projectFilter.value, projectFilter.id]
  );
  return response.status(200).json({ summary: result.rows[0] });
});

// Returns one zero-filled SQL-aggregated activity row for each requested date.
router.get("/activity", async function (request, response) {
  const input = activityQuerySchema.safeParse(request.query);
  if (!input.success) return response.status(400).json({ error: input.error.issues[0].message });

  const result = await pool.query(
    `WITH date_range AS (
       SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day')::date AS day
     ), activity_events AS (
       SELECT h.created_at::date AS event_day,
              COUNT(*) FILTER (WHERE h.text LIKE 'Completed step:%')::int AS "stepsTicked",
              COUNT(*) FILTER (WHERE h.text IN ('Marked as done', 'Marked as done before the deadline', 'All steps done, task completed'))::int AS "tasksCompleted",
              0::int AS "notesAdded"
         FROM history h
         JOIN tasks t ON t.id = h.task_id
        WHERE t.user_id = $2
          AND h.created_at >= CURRENT_DATE - ($1::int - 1)
          AND h.created_at < CURRENT_DATE + INTERVAL '1 day'
        GROUP BY h.created_at::date
       UNION ALL
       SELECT n.created_at::date AS event_day,
              0::int AS "stepsTicked",
              0::int AS "tasksCompleted",
              COUNT(*)::int AS "notesAdded"
         FROM notes n
         JOIN tasks t ON t.id = n.task_id
        WHERE t.user_id = $2
          AND n.created_at >= CURRENT_DATE - ($1::int - 1)
          AND n.created_at < CURRENT_DATE + INTERVAL '1 day'
        GROUP BY n.created_at::date
     ), daily_activity AS (
       SELECT event_day,
              SUM("stepsTicked")::int AS "stepsTicked",
              SUM("tasksCompleted")::int AS "tasksCompleted",
              SUM("notesAdded")::int AS "notesAdded"
         FROM activity_events
        GROUP BY event_day
     )
     SELECT date_range.day::text AS date,
            COALESCE(daily_activity."stepsTicked", 0)::int AS "stepsTicked",
            COALESCE(daily_activity."tasksCompleted", 0)::int AS "tasksCompleted",
            COALESCE(daily_activity."notesAdded", 0)::int AS "notesAdded"
       FROM date_range
       LEFT JOIN daily_activity ON daily_activity.event_day = date_range.day
      ORDER BY date_range.day`,
    [input.data.days, request.user.id]
  );
  return response.status(200).json({ days: result.rows });
});

// Returns the current run of consecutive days with a completed task or step.
router.get("/streak", async function (request, response) {
  const result = await pool.query(
    `WITH active_days AS (
       SELECT DISTINCT h.created_at::date AS active_day
         FROM history h
         JOIN tasks t ON t.id = h.task_id
        WHERE t.user_id = $1
          AND (h.text LIKE 'Completed step:%' OR h.text IN ('Marked as done', 'Marked as done before the deadline', 'All steps done, task completed'))
          AND h.created_at < CURRENT_DATE + INTERVAL '1 day'
     ), streak_anchor AS (
       SELECT MAX(active_day) AS last_active_day
         FROM active_days
        WHERE active_day >= CURRENT_DATE - 1
     ), ordered_active_days AS (
       SELECT active_days.active_day,
              (streak_anchor.last_active_day - active_days.active_day)::int AS days_back,
              ROW_NUMBER() OVER (ORDER BY active_days.active_day DESC) - 1 AS expected_days_back
         FROM active_days
         CROSS JOIN streak_anchor
        WHERE streak_anchor.last_active_day IS NOT NULL
          AND active_days.active_day <= streak_anchor.last_active_day
     )
     SELECT COALESCE((SELECT COUNT(*)::int FROM ordered_active_days WHERE days_back = expected_days_back), 0) AS "currentStreak",
            (SELECT last_active_day::text FROM streak_anchor) AS "lastActiveDate"`,
    [request.user.id]
  );
  return response.status(200).json({ streak: result.rows[0] });
});

module.exports = router;

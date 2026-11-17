// This file returns current task reminders for the signed-in user without storing them.
const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Finds unfinished overdue, due-today, and near-term tasks in one database query.
router.get("/", async function (request, response) {
  const result = await pool.query(
    `SELECT CASE
              WHEN due_date < CURRENT_DATE THEN 'overdue'
              WHEN due_date = CURRENT_DATE THEN 'due_today'
              ELSE 'due_soon'
            END AS type,
            id AS "taskId", title, due_date::text AS "dueDate"
       FROM tasks
      WHERE user_id = $1
        AND status <> 'completed'
        AND due_date IS NOT NULL
        AND due_date <= CURRENT_DATE + INTERVAL '2 days'
      ORDER BY due_date, id`,
    [request.user.id]
  );
  return response.status(200).json({ notifications: result.rows });
});

module.exports = router;

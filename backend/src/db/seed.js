// This file adds one reusable demo account and sample Tasklog work to a development database.
require("dotenv").config();

// Stops before opening a database connection when this command targets production.
if (process.env.NODE_ENV === "production") {
  console.error("The demo seed is disabled in production.");
  process.exitCode = 1;
} else {
  const bcrypt = require("bcrypt");
  const pool = require("./pool");

  const demoPassword = "TasklogDemo2026!";
  const demoProjects = [
    { name: "Website refresh", color: "#2563EB" },
    { name: "Personal growth", color: "#16A34A" }
  ];
  const demoTasks = [
    { project: 0, title: "Review the home page layout", status: "completed", priority: "high", dueDays: -8, age: 12, steps: ["Collect feedback", "Update spacing", "Check mobile layout"] },
    { project: 0, title: "Write the product overview", status: "in_progress", priority: "medium", dueDays: 2, age: 6, steps: ["Outline the sections", "Draft the first version", "Ask for a review"] },
    { project: 0, title: "Prepare launch checklist", status: "pending", priority: "high", dueDays: 4, age: 3, steps: ["Check the main pages", "Confirm analytics", "Share the checklist"] },
    { project: 0, title: "Check contact form messages", status: "completed", priority: "low", dueDays: -5, age: 9, steps: ["Test a new message", "Confirm the reply email"] },
    { project: 0, title: "Choose updated project photos", status: "pending", priority: "low", dueDays: 8, age: 2, steps: ["Gather photo options", "Pick the final set"] },
    { project: 0, title: "Make the footer easier to scan", status: "in_progress", priority: "medium", dueDays: 1, age: 5, steps: ["Group related links", "Check on a phone"] },
    { project: 1, title: "Plan this month's reading", status: "completed", priority: "medium", dueDays: -12, age: 13, steps: ["Choose three books", "Set weekly reading time"] },
    { project: 1, title: "Practice a short presentation", status: "in_progress", priority: "high", dueDays: 3, age: 7, steps: ["Write the key points", "Practice once", "Trim the ending"] },
    { project: 1, title: "Organize study notes", status: "pending", priority: "low", dueDays: null, age: 4, steps: ["Sort notes by topic", "Mark open questions"] },
    { project: 1, title: "Schedule a weekly walk", status: "completed", priority: "low", dueDays: -2, age: 3, steps: ["Pick a route", "Add a calendar reminder"] },
    { project: 1, title: "Finish the course lessons", status: "pending", priority: "medium", dueDays: -1, age: 10, steps: ["Watch the next lesson", "Write down three takeaways"] },
    { project: 1, title: "Set next month's goals", status: "in_progress", priority: "medium", dueDays: 7, age: 8, steps: ["Review current goals", "Choose one new habit"] }
  ];

  // Creates or refreshes the demo content inside one database transaction.
  async function seedDemoData() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const passwordHash = await bcrypt.hash(demoPassword, 10);
      const userResult = await client.query(
        "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash RETURNING id",
        ["Tasklog Demo", "demo@tasklog.test", passwordHash]
      );
      const userId = userResult.rows[0].id;
      await client.query("DELETE FROM tasks WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM projects WHERE user_id = $1", [userId]);
      const projectIds = [];

      for (const project of demoProjects) {
        const result = await client.query(
          "INSERT INTO projects (user_id, name, color) VALUES ($1, $2, $3) RETURNING id",
          [userId, project.name, project.color]
        );
        projectIds.push(result.rows[0].id);
      }

      for (let taskIndex = 0; taskIndex < demoTasks.length; taskIndex += 1) {
        const task = demoTasks[taskIndex];
        const taskResult = await client.query(
          "INSERT INTO tasks (user_id, project_id, title, description, status, priority, due_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END, NOW() - ($8::int * INTERVAL '1 day'), NOW()) RETURNING id",
          [userId, projectIds[task.project], task.title, "A practical sample task for the Tasklog demo workspace.", task.status, task.priority, task.dueDays, task.age]
        );
        const taskId = taskResult.rows[0].id;

        for (let stepIndex = 0; stepIndex < task.steps.length; stepIndex += 1) {
          const done = task.status === "completed" || (task.status === "in_progress" && stepIndex === 0);
          const stepResult = await client.query(
            "INSERT INTO steps (task_id, text, done, position) VALUES ($1, $2, $3, $4) RETURNING id",
            [taskId, task.steps[stepIndex], done, stepIndex]
          );
          if (done) {
            await client.query(
              "INSERT INTO history (task_id, text, created_at) VALUES ($1, $2, NOW() - ($3::int * INTERVAL '1 day'))",
              [taskId, "Completed step: " + task.steps[stepIndex], Math.max(0, task.age - stepIndex)]
            );
          }
          if (task.status === "completed" && stepIndex === task.steps.length - 1) {
            await client.query(
              "INSERT INTO history (task_id, text, created_at) VALUES ($1, $2, NOW() - ($3::int * INTERVAL '1 day'))",
              [taskId, "All steps done, task completed", Math.max(0, task.age - 1)]
            );
          }
        }

        if (taskIndex % 2 === 0) {
          await client.query(
            "INSERT INTO notes (task_id, text, created_at) VALUES ($1, $2, NOW() - ($3::int * INTERVAL '1 day'))",
            [taskId, "Progress update: the next action is clear and ready to pick up.", Math.max(0, task.age - 1)]
          );
        }
      }

      await client.query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
      await client.query("COMMIT");
      console.info("Demo data is ready. Log in as demo@tasklog.test with the password shown in README.md.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Runs the seed command and closes the connection pool after success or failure.
  async function main() {
    try {
      await seedDemoData();
    } catch (error) {
      console.error("Could not seed demo data:", error.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }

  main();
}

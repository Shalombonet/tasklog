// This file validates task request bodies, query filters, and numeric route ids.
const { z } = require("zod");

const taskStatuses = ["pending", "in_progress", "completed"];
const taskPriorities = ["low", "medium", "high"];

// Validates an optional project assignment or null to move a task to Inbox.
const projectAssignmentSchema = z.union([z.number().int().positive(), z.null()]).optional();

// Validates the positive integer database id in a URL parameter.
const taskIdSchema = z.coerce.number().int().positive();

// Validates an optional checklist included when a task is first created.
const createStepSchema = z.object({
  text: z.string().trim().min(1, "Step text is required").max(500, "Step text is too long"),
  source: z.enum(["user", "ai"]).optional(),
  position: z.number().int().min(0).optional()
});

// Validates the task fields accepted when creating a task.
const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().max(5000, "Description is too long").optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.union([z.string().date(), z.literal(""), z.null()]).optional(),
  projectId: projectAssignmentSchema,
  steps: z.array(createStepSchema).max(100, "A task can have at most 100 steps").optional()
});

// Validates any subset of editable task fields sent to PATCH.
const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long").optional(),
  description: z.string().max(5000, "Description is too long").optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.union([z.string().date(), z.literal(""), z.null()]).optional(),
  projectId: projectAssignmentSchema
}).refine(function (values) {
  return Object.keys(values).length > 0;
}, "Provide at least one task field to update");

// Validates the fields accepted when adding one checklist item.
const addStepSchema = createStepSchema;

// Validates a partial update to a checklist item.
const updateStepSchema = z.object({
  text: z.string().trim().min(1, "Step text is required").max(500, "Step text is too long").optional(),
  done: z.boolean().optional(),
  position: z.number().int().min(0).optional()
}).refine(function (values) {
  return Object.keys(values).length > 0;
}, "Provide a step field to update");

// Validates the text accepted when adding a note.
const createNoteSchema = z.object({
  text: z.string().trim().min(1, "Note text is required").max(5000, "Note is too long")
});

// Ensures a task search does not start after its end date.
function hasValidTaskDateRange(filters) {
  return !filters.from || !filters.to || filters.from <= filters.to;
}

// Validates the optional task-list filters.
const listTasksQuerySchema = z.object({
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  search: z.string().trim().max(200, "Search text is too long").optional(),
  projectId: z.union([z.literal("inbox"), z.coerce.number().int().positive()]).optional(),
  from: z.string().date("Start date must use YYYY-MM-DD.").optional(),
  to: z.string().date("End date must use YYYY-MM-DD.").optional()
}).refine(hasValidTaskDateRange, { message: "Start date must be on or before end date.", path: ["from"] });

module.exports = { taskIdSchema, createTaskSchema, updateTaskSchema, addStepSchema, updateStepSchema, createNoteSchema, listTasksQuerySchema };

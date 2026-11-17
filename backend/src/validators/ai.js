// This file validates requests and model responses for AI step suggestions.
const { z } = require("zod");

// Checks only the task details needed to generate useful checklist suggestions.
const suggestStepsRequestSchema = z.object({
  title: z.string().trim().min(1, "Enter a task title first.").max(120, "Task title must be 120 characters or fewer."),
  description: z.string().max(1000, "Description must be 1,000 characters or fewer.").optional().default(""),
  existingSteps: z.array(z.string().trim().min(1).max(500)).max(20, "Provide no more than 20 existing steps.").optional().default([])
});

// Checks that the model returned a useful list of short steps.
const suggestStepsResponseSchema = z.array(z.string().trim().min(1).max(80)).min(4).max(7);

module.exports = { suggestStepsRequestSchema, suggestStepsResponseSchema };

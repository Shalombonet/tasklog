// This file validates project request data and route ids.
const { z } = require("zod");

const projectColors = ["#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2"];

// Validates a positive integer project id from a URL.
const projectIdSchema = z.coerce.number().int().positive();

// Validates the name and palette color accepted when creating a project.
const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(80, "Project name must be 80 characters or fewer."),
  color: z.enum(projectColors)
});

// Checks that a project update contains at least one editable field.
function hasProjectFields(values) {
  return Object.keys(values).length > 0;
}

// Validates any non-empty subset of project fields accepted when renaming or recoloring.
const updateProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required.").max(80, "Project name must be 80 characters or fewer.").optional(),
  color: z.enum(projectColors).optional()
}).refine(hasProjectFields, "Provide a project name or color to update.");

module.exports = { projectColors, projectIdSchema, createProjectSchema, updateProjectSchema };

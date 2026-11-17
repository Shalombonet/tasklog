// This file validates project filters and activity date ranges for statistics.
const { z } = require("zod");

// Validates either the Inbox filter or a positive project id from a URL query.
const projectFilterSchema = z.union([z.literal("inbox"), z.coerce.number().int().positive()]).optional();

// Validates the requested number of activity days and supplies the default range.
const activityQuerySchema = z.object({
  days: z.coerce.number().int().min(1, "Choose at least one day.").max(90, "Choose no more than 90 days.").default(30)
});

module.exports = { projectFilterSchema, activityQuerySchema };

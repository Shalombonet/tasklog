// This file validates profile, password, and user settings requests.
const { z } = require("zod");

// Validates a name update for the signed-in user's profile.
const updateNameSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100, "Name is too long.")
});

// Validates the old password and a new password for password changes.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(200, "Password is too long."),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(200, "Password is too long.")
});

// Validates optional updates to the signed-in user's task preferences.
const updateSettingsSchema = z.object({
  defaultPriority: z.enum(["low", "medium", "high"]).optional(),
  showCompletedTasks: z.boolean().optional()
}).refine(function (settings) {
  return Object.keys(settings).length > 0;
}, { message: "Choose at least one setting to update." });

module.exports = { updateNameSchema, changePasswordSchema, updateSettingsSchema };

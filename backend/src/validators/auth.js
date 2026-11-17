// This file validates the JSON fields sent to the authentication endpoints.
const { z } = require("zod");

// Validates the fields required to register a new account.
const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  email: z.string().trim().email("Enter a valid email address").max(254, "Email is too long"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(16, "Password must be at most 16 characters")
    .regex(/[A-Za-z]/, "Password must include at least one letter")
    .regex(/[0-9]/, "Password must include at least one digit")
    .regex(/[^A-Za-z0-9]/, "Password must include at least one special character")
});

// Validates the credentials required to log in.
const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254, "Email is too long"),
  password: z.string().min(1, "Password is required").max(200, "Password is too long")
});

// Validates the password needed to confirm an account deletion.
const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required").max(200, "Password is too long")
});

module.exports = { registerSchema, loginSchema, deleteAccountSchema };

// This file provides authenticated AI helpers for Tasklog.
const express = require("express");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middleware/auth");
const { suggestSteps } = require("../services/ai");
const { suggestStepsRequestSchema, suggestStepsResponseSchema } = require("../validators/ai");

const router = express.Router();
const suggestionLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: function (request) { return String(request.user.id); },
  standardHeaders: true,
  legacyHeaders: false,
  handler: function (request, response) {
    response.status(429).json({ error: "You've reached the suggestion limit. Please try again later." });
  }
});

// Generates steps from only the task information supplied by the signed-in user.
router.post("/suggest-steps", requireAuth, suggestionLimit, async function (request, response) {
  const input = suggestStepsRequestSchema.safeParse(request.body);
  if (!input.success) {
    return response.status(400).json({ error: input.error.issues[0].message });
  }

  try {
    const suggestions = await suggestSteps(input.data);
    const parsed = suggestStepsResponseSchema.safeParse(suggestions);
    if (!parsed.success) throw new Error("AI returned an invalid suggestion list");

    const existing = new Set(input.data.existingSteps.map(function (step) { return step.toLowerCase(); }));
    const unique = [];
    parsed.data.forEach(function (step) {
      const normalized = step.toLowerCase();
      if (!existing.has(normalized) && !unique.some(function (item) { return item.toLowerCase() === normalized; })) unique.push(step);
    });
    if (unique.length < 4) throw new Error("AI returned too few unique suggestions");
    return response.status(200).json({ suggestions: unique });
  } catch (error) {
    const apiKey = process.env.GEMINI_API_KEY;
    const providerMessage = typeof error.message === "string" ? error.message.slice(0, 500) : null;
    console.error("AI step suggestion request failed", {
      name: error.name,
      code: error.code || null,
      status: Number.isInteger(error.status) ? error.status : null,
      message: providerMessage && apiKey ? providerMessage.replaceAll(apiKey, "[redacted]") : providerMessage,
      causeName: error.cause && error.cause.name ? error.cause.name : null,
      causeCode: error.cause && error.cause.code ? error.cause.code : null,
      causeMessage: error.cause && error.cause.message
        ? String(error.cause.message).slice(0, 300).replaceAll(apiKey || "\u0000", "[redacted]")
        : null
    });
    if (error.code === "AI_NOT_CONFIGURED") {
      return response.status(503).json({ error: "AI suggestions are not configured yet. Add the AI settings and try again." });
    }
    if (error.code === "AI_RATE_LIMIT") {
      return response.status(429).json({ error: "AI is busy, try again in a minute" });
    }
    if (error.code === "AI_BUSY") {
      return response.status(503).json({ error: "AI is busy, try again in a minute" });
    }
    if (error.code === "AI_CONNECTION") {
      return response.status(503).json({ error: "The AI service could not be reached. Check the backend's internet connection and try again." });
    }
    const timedOut = error.code === "AI_TIMEOUT" || error.name === "TimeoutError";
    return response.status(timedOut ? 503 : 502).json({ error: "AI suggestions are temporarily unavailable. Please try again." });
  }
});

module.exports = router;

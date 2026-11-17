<!-- This guide introduces Tasklog and explains how to run it locally. -->
# Tasklog

Tasklog is a full-stack task management app for organizing daily work into projects, tracking progress, and reviewing completed work. It uses a plain HTML, CSS, and JavaScript frontend with an Express and PostgreSQL backend.

## Features

- Task board with pending, in-progress, and completed tasks, priorities, due dates, and checklists
- Projects, an Inbox for unassigned tasks, and project-based task filtering
- Task notes with image attachments and a history of changes
- Month calendar with due-date updates and a mobile agenda view
- Dashboard, activity reports, completion summaries, and print-friendly reports
- Profile and account settings, notification reminders, and light or dark appearance
- Optional Gemini checklist suggestions through Google's official `@google/genai` Node.js SDK
- Authenticated API, httpOnly session cookies, request validation, and per-user data access

## Technology

- Frontend: HTML, CSS, and browser JavaScript
- Backend: Node.js and Express
- Database: PostgreSQL
- Validation and security: Zod, bcrypt, Helmet, and rate limiting
- AI: Google Gemini using `@google/genai`

## Run locally

### Requirements

- Node.js and npm
- PostgreSQL
- A Gemini API key if you want to use AI step suggestions

### Setup

1. Create a PostgreSQL database for Tasklog.
2. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` and `JWT_SECRET`. Add `GEMINI_API_KEY` to enable AI suggestions.
3. Open a terminal in `backend` and install the dependencies:

   ```sh
   npm ci
   ```

4. Create the database tables and run the migrations:

   ```sh
   npm run db:migrate
   ```

5. Start the app:

   ```sh
   npm run dev
   ```

6. Open `http://localhost:3000` (or the port set in `backend/.env`).

### Optional demo data

After migrations, run `npm run seed` from `backend` to create two sample projects, 12 tasks, checklist steps, notes, and recent activity.

| Demo sign-in | Value |
| --- | --- |
| Email | `demo@tasklog.test` |
| Password | `TasklogDemo2026!` |

Running the seed again replaces tasks and projects for this demo account only. It refuses to run when `NODE_ENV=production`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign the authentication cookie |
| `PORT` | Web server port; defaults to `3000` |
| `NODE_ENV` | Set to `development` locally and `production` when deployed |
| `GEMINI_API_KEY` | Gemini API key used only by the backend |
| `AI_MODEL` | Gemini model identifier used for step suggestions |

Never commit `backend/.env` or put API keys in frontend files. The root `.gitignore` excludes environment files, uploads, and installed dependencies; `backend/.env.example` contains placeholders only.

## Repository description

Suggested GitHub description:

> Full-stack task management app built with vanilla JavaScript, Express, and PostgreSQL, with projects, reports, calendar scheduling, secure cookie authentication, image notes, and Gemini-powered checklist suggestions.

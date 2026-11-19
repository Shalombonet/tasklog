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

The seed script can create two sample projects, 12 tasks, checklist steps, notes, and recent activity. It refuses to run unless you temporarily set `ALLOW_SEED=true` for that one command, including when the database is hosted in production. See the deployment steps below for the safe PowerShell commands.

| Demo sign-in | Value |
| --- | --- |
| Email | `demo@tasklog.test` |
| Password | `TasklogDemo2026!` |

Running the seed again replaces tasks and projects for this demo account only. The explicit `ALLOW_SEED=true` check is required for every run. Do not set it in Render. The demo email and password above are public sample credentials; anyone can sign in to the seeded demo account, so do not store private work there.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign the authentication cookie |
| `PORT` | Web server port; defaults to `3000` |
| `NODE_ENV` | Set to `development` locally and `production` when deployed |
| `GEMINI_API_KEY` | Gemini API key used only by the backend |
| `AI_MODEL` | Gemini model identifier used for step suggestions |
| `ALLOW_SEED` | Optional seed-script safety switch; keep `false` except for one explicitly approved seed run |

Never commit `backend/.env` or put API keys in frontend files. The root `.gitignore` excludes environment files, uploads, and installed dependencies; `backend/.env.example` contains placeholders only.

## First deployment on Render and Neon

1. In Neon, create a PostgreSQL project and copy its connection string. Keep it private; use the connection string with `?sslmode=require`. Use Neon's pooled connection string for the Render service, and keep a direct connection string handy for the one-time migration from your computer.
2. Before deploying, run the database migration from PowerShell. Open PowerShell in the repository's `backend` folder, then enter:

   ```powershell
   Set-Location 'C:\Users\Shalom\personal-tms\backend'
   $secureUrl = Read-Host "Paste the Neon connection string" -AsSecureString
   $env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
   npm run db:migrate
   Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
   Remove-Variable secureUrl -ErrorAction SilentlyContinue
   ```

   Use the direct Neon connection string at this step. The password is entered as hidden text and the environment variable is removed afterward.
3. Only if you want the public demo account and sample tasks in this Neon database, set the same hidden `DATABASE_URL` as above, then run this temporary opt-in:

   ```powershell
   Set-Location 'C:\Users\Shalom\personal-tms\backend'
   $secureUrl = Read-Host "Paste the Neon connection string" -AsSecureString
   $env:DATABASE_URL = [System.Net.NetworkCredential]::new("", $secureUrl).Password
   $env:ALLOW_SEED = "true"
   npm run seed
   Remove-Item Env:DATABASE_URL, Env:ALLOW_SEED -ErrorAction SilentlyContinue
   Remove-Variable secureUrl -ErrorAction SilentlyContinue
   ```

   The seed replaces the sample demo account's tasks and projects when run again. Keep `ALLOW_SEED` unset in Render.
4. Push the deployment changes to your GitHub `main` branch. In Render, choose **New > Web Service** and connect `Shalombonet/tasklog`.
5. Set Render **Root Directory** to `backend`, **Build Command** to `npm ci`, **Start Command** to `npm start`, and **Health Check Path** to `/api/health`. Node.js 22 through 24 is supported by the package's `engines` range.
6. Add these Render environment variables: `DATABASE_URL` (Neon pooled URL ending in `?sslmode=require`), `JWT_SECRET` (a new, long random secret), `NODE_ENV=production`, `GEMINI_API_KEY` (optional), and `AI_MODEL=gemini-3.8-flash`. Render supplies `PORT` automatically. Leave `ALLOW_SEED` unset. If you omit the Gemini key, only AI suggestions are unavailable; the app and other features still run.
7. Deploy, then open the Render URL. Check `/api/health`, register a fresh account, sign in over HTTPS, and test the app. Never add production secrets to GitHub or to frontend files.

### Note image storage on free hosting

Tasklog currently stores uploaded note images in `backend/uploads` on the server's local disk. A free web host can replace that disk during a restart or redeploy, so those images may disappear even though their database records remain. Options are to keep uploads for disposable demo use, temporarily avoid uploading images in the live demo, pay for persistent disk where available, or later choose external object storage such as Cloudinary. Cloudinary currently lists a free plan with monthly usage credits. I have not changed image storage; choose a durable storage option before relying on uploaded images in production.

## Repository description

Suggested GitHub description:

> Full-stack task management app built with vanilla JavaScript, Express, and PostgreSQL, with projects, reports, calendar scheduling, secure cookie authentication, image notes, and Gemini-powered checklist suggestions.

// This file creates a reusable PostgreSQL connection pool from .env settings.
require("dotenv").config();
const { Pool } = require("pg");

// Creates pooled database connections using the configured connection URL.
function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add it to backend/.env before connecting.");
  }

  return new Pool({ connectionString: process.env.DATABASE_URL });
}

const pool = createPool();

module.exports = pool;

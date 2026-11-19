// This file creates a reusable PostgreSQL connection pool from .env settings.
require("dotenv").config();
const { Pool } = require("pg");

// Creates pooled database connections using the configured connection URL.
function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add it to backend/.env before connecting.");
  }

  if (process.env.NODE_ENV === "production") {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    if (databaseUrl.searchParams.get("sslmode") !== "require") {
      throw new Error("Production DATABASE_URL must include ?sslmode=require for an encrypted database connection.");
    }
  }

  // node-postgres reads sslmode=require from the URL and opens a verified TLS connection.
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

const pool = createPool();

module.exports = pool;

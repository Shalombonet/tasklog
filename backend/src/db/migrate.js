// This file applies the base schema and numbered database migrations to Tasklog.
const fs = require("fs");
const path = require("path");
const pool = require("./pool");

// Keeps only SQL files when the migration folder is read.
function isSqlMigration(fileName) {
  return fileName.endsWith(".sql");
}

// Runs the base schema first, then each numbered SQL migration in order.
async function runMigration() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, "");
  await pool.query(schemaSql);

  const migrationsPath = path.join(__dirname, "migrations");
  const migrationFiles = fs.readdirSync(migrationsPath)
    .filter(isSqlMigration)
    .sort();
  for (const fileName of migrationFiles) {
    const migrationSql = fs.readFileSync(path.join(migrationsPath, fileName), "utf8").replace(/^\uFEFF/, "");
    await pool.query(migrationSql);
    console.info("Applied database migration " + fileName + ".");
  }
  console.info("Tasklog database schema is ready.");
}

// Runs the migration and always closes the pool when it finishes.
async function main() {
  try {
    await runMigration();
  } catch (error) {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

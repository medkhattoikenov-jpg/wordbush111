"use strict";
const fs = require("node:fs");
const path = require("node:path");

async function openDatabase(options = {}) {
  let db;
  if (options.url || process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: options.url || process.env.DATABASE_URL,
      max: 8,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (error) =>
      console.error("Database pool error:", error.code || "unavailable"),
    );
    db = {
      kind: "postgres",
      query: (sql, params) => pool.query(sql, params),
      close: () => pool.end(),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (process.env.NODE_ENV === "production")
      throw Error("DATABASE_URL is required in production.");
    const { PGlite } = require("@electric-sql/pglite");
    const dataDir =
      options.dataDir ||
      process.env.LOCAL_DATABASE_DIR ||
      path.join(__dirname, "..", ".data", "postgres");
    if (dataDir !== "memory://") fs.mkdirSync(dataDir, { recursive: true });
    const embedded = new PGlite(dataDir);
    await embedded.waitReady;
    db = {
      kind: "local-postgres",
      query: (sql, params) => embedded.query(sql, params),
      close: () => embedded.close(),
      transaction: (fn) => embedded.transaction(fn),
    };
  }
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  const folder = path.join(__dirname, "..", "migrations");
  for (const name of fs
    .readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.transaction(async (tx) => {
      // The deployment runs one application instance; this lock also serializes PostgreSQL migrations.
      await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      if (
        (
          await tx.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rows.length
      )
        return;
      const sql = fs.readFileSync(path.join(folder, name), "utf8");
      for (const statement of sql
        .split(";")
        .map((value) => value.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    });
  }
  return db;
}
module.exports = { openDatabase };

import { sql } from "bun";

import { logger } from "./logger";

const DEFAULT_MIGRATIONS_DIR = "./migrations";

// Advisory lock ID for migrations (hash of "bun-psql-migrations")
// Using a fixed number to ensure consistency across processes
const MIGRATION_LOCK_ID = 5432_1234;

/**
 * Acquire a transaction-level advisory lock for migrations
 * This lock is automatically released when the transaction ends
 * Returns true if lock was acquired, false if already held by another process
 */
async function tryAcquireTransactionLock(tx: typeof sql): Promise<boolean> {
  const result =
    await tx`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
  return result[0].pg_try_advisory_xact_lock === true;
}

/**
 * Get the migrations directory from environment or use default
 */
export function getMigrationsDir(): string {
  return process.env.MIGRATIONS_DIR || DEFAULT_MIGRATIONS_DIR;
}

/**
 * Generate a timestamp string for migration naming (YYYYMMDDHHmmss)
 */
export function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Extract the base migration name from a filename
 * e.g., "20260129120000_add_users.up.sql" -> "20260129120000_add_users"
 */
export function getMigrationBaseName(filename: string): string {
  return filename.replace(/\.(up|down)\.sql$/, "");
}

/**
 * Ensure the _migrations tracking table exists
 */
export async function ensureMigrationsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Get list of applied migration IDs from the database
 */
export async function getAppliedMigrations(): Promise<string[]> {
  await ensureMigrationsTable();
  const rows = await sql`SELECT id FROM _migrations ORDER BY applied_at ASC`;
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Get list of pending migrations (not yet applied)
 */
export async function getPendingMigrations(dir?: string): Promise<string[]> {
  const migrationsDir = dir || getMigrationsDir();
  const applied = new Set(await getAppliedMigrations());

  let files: string[] = [];
  try {
    files = (
      await Array.fromAsync(new Bun.Glob("*.up.sql").scan(migrationsDir))
    ).sort();
  } catch {
    logger.warn(
      `Migrations directory not found or unreadable: ${migrationsDir}`,
    );
    return [];
  }

  return files
    .map((f) => getMigrationBaseName(f))
    .filter((name) => !applied.has(name));
}

/**
 * Apply all pending migrations
 */
export async function migrate(dir?: string): Promise<void> {
  const migrationsDir = dir || getMigrationsDir();
  logger.info(`Using migrations directory: ${migrationsDir}`);
  await ensureMigrationsTable();

  const pending = await getPendingMigrations(migrationsDir);

  if (pending.length === 0) {
    logger.warn("No pending migrations");
    return;
  }

  for (const migrationName of pending) {
    const upFile = `${migrationsDir}/${migrationName}.up.sql`;

    // Check if up file exists
    const upFileExists = await Bun.file(upFile).exists();
    if (!upFileExists) {
      throw new Error(`Up migration file not found: ${upFile}`);
    }

    const sqlText = await Bun.file(upFile).text();

    logger.info(`▶ applying ${migrationName}`);

    await sql.begin(async (tx) => {
      // Acquire transaction-level lock (automatically released when tx ends)
      const lockAcquired = await tryAcquireTransactionLock(tx);
      if (!lockAcquired) {
        throw new Error(
          "Could not acquire migration lock. Another migration process may be running.",
        );
      }

      await tx.unsafe(sqlText);
      await tx`INSERT INTO _migrations (id) VALUES (${migrationName})`;
    });
  }

  logger.info(`✅ applied ${pending.length} migration(s)`);
}

/**
 * Rollback the last applied migration
 */
export async function rollback(dir?: string): Promise<void> {
  const migrationsDir = dir || getMigrationsDir();
  await ensureMigrationsTable();

  // Get the last applied migration
  const rows =
    await sql`SELECT id FROM _migrations ORDER BY applied_at DESC LIMIT 1`;

  if (rows.length === 0) {
    logger.warn("No migrations to rollback");
    return;
  }

  const migrationName = rows[0].id as string;
  const downFile = `${migrationsDir}/${migrationName}.down.sql`;

  // Check if down file exists
  const downFileExists = await Bun.file(downFile).exists();
  if (!downFileExists) {
    throw new Error(`Down migration file not found: ${downFile}`);
  }

  const sqlText = await Bun.file(downFile).text();

  logger.info(`◀ rolling back ${migrationName}`);

  await sql.begin(async (tx) => {
    // Acquire transaction-level lock (automatically released when tx ends)
    const lockAcquired = await tryAcquireTransactionLock(tx);
    if (!lockAcquired) {
      throw new Error(
        "Could not acquire migration lock. Another migration process may be running.",
      );
    }

    await tx.unsafe(sqlText);
    await tx`DELETE FROM _migrations WHERE id = ${migrationName}`;
  });

  logger.info(`✅ rolled back ${migrationName}`);
}

/**
 * Reset all migrations (rollback all in reverse order)
 */
export async function reset(dir?: string): Promise<void> {
  const migrationsDir = dir || getMigrationsDir();
  await ensureMigrationsTable();

  // Get all applied migrations in reverse order (newest first)
  const rows = await sql`SELECT id FROM _migrations ORDER BY applied_at DESC`;

  if (rows.length === 0) {
    logger.warn("No migrations to reset");
    return;
  }

  logger.info(`Resetting ${rows.length} migration(s)...`);

  for (const row of rows) {
    const migrationName = row.id as string;
    const downFile = `${migrationsDir}/${migrationName}.down.sql`;

    // Check if down file exists
    const downFileExists = await Bun.file(downFile).exists();
    if (!downFileExists) {
      throw new Error(`Down migration file not found: ${downFile}`);
    }

    const sqlText = await Bun.file(downFile).text();

    logger.info(`◀ rolling back ${migrationName}`);

    await sql.begin(async (tx) => {
      // Acquire transaction-level lock (automatically released when tx ends)
      const lockAcquired = await tryAcquireTransactionLock(tx);
      if (!lockAcquired) {
        throw new Error(
          "Could not acquire migration lock. Another migration process may be running.",
        );
      }

      await tx.unsafe(sqlText);
      await tx`DELETE FROM _migrations WHERE id = ${migrationName}`;
    });
  }

  logger.info(`✅ reset complete - rolled back ${rows.length} migration(s)`);
}

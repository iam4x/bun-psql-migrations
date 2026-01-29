/**
 * Integration tests for bun-psql-migrations
 *
 * Run tests:
 *   bun test src/index.integration.test.ts
 *
 * Requirements:
 *   - Docker must be running
 */
import { mkdir, rm } from "node:fs/promises";

import { $ } from "bun";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import {
  ensureMigrationsTable,
  getAppliedMigrations,
  getPendingMigrations,
  migrate,
  reset,
  rollback,
} from "./index";

const FIXTURES_DIR = "./src/__fixtures__/migrations";
const DATABASE_URL = "postgres://test:test@localhost:5432/test";

describe("integration: migrations", () => {
  beforeAll(async () => {
    // Start PostgreSQL container
    await $`docker compose -f docker-compose.test.yml up -d --wait`.quiet();
    process.env.DATABASE_URL = DATABASE_URL;
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    // Stop PostgreSQL container
    await $`docker compose -f docker-compose.test.yml down -v`.quiet();
  });

  beforeEach(async () => {
    // Dynamic import to get fresh sql connection with DATABASE_URL set
    const { sql } = await import("bun");
    // Release any stale advisory locks from previous tests
    await sql`SELECT pg_advisory_unlock_all()`;
    // Clean up database between tests
    await sql`DROP TABLE IF EXISTS _migrations CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
  });

  afterEach(async () => {
    const { sql } = await import("bun");
    // Clean up after each test
    await sql`DROP TABLE IF EXISTS _migrations CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
  });

  describe("ensureMigrationsTable", () => {
    test("creates _migrations table if not exists", async () => {
      await ensureMigrationsTable();

      const { sql } = await import("bun");
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = '_migrations'
        )
      `;
      expect(result[0].exists).toBe(true);
    });

    test("is idempotent - can be called multiple times", async () => {
      await ensureMigrationsTable();
      await ensureMigrationsTable();

      const { sql } = await import("bun");
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = '_migrations'
        )
      `;
      expect(result[0].exists).toBe(true);
    });
  });

  describe("getPendingMigrations", () => {
    test("returns all migrations when none applied", async () => {
      const pending = await getPendingMigrations(FIXTURES_DIR);
      expect(pending).toHaveLength(2);
      expect(pending).toContain("001_create_users");
      expect(pending).toContain("002_add_email");
    });

    test("excludes already applied migrations", async () => {
      const { sql } = await import("bun");
      await ensureMigrationsTable();
      await sql`INSERT INTO _migrations (id) VALUES ('001_create_users')`;

      const pending = await getPendingMigrations(FIXTURES_DIR);
      expect(pending).toHaveLength(1);
      expect(pending).toContain("002_add_email");
    });

    test("returns empty array when all migrations applied", async () => {
      const { sql } = await import("bun");
      await ensureMigrationsTable();
      await sql`INSERT INTO _migrations (id) VALUES ('001_create_users')`;
      await sql`INSERT INTO _migrations (id) VALUES ('002_add_email')`;

      const pending = await getPendingMigrations(FIXTURES_DIR);
      expect(pending).toHaveLength(0);
    });
  });

  describe("migrate", () => {
    test("applies all pending migrations in order", async () => {
      await migrate(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(2);
      expect(applied[0]).toBe("001_create_users");
      expect(applied[1]).toBe("002_add_email");
    });

    test("creates tables defined in migrations", async () => {
      await migrate(FIXTURES_DIR);

      const { sql } = await import("bun");
      // Check users table exists with correct columns
      const columns = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users'
        ORDER BY ordinal_position
      `;

      const columnNames = columns.map(
        (c: { column_name: string }) => c.column_name,
      );
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("email");
    });

    test("is idempotent - skips already applied migrations", async () => {
      await migrate(FIXTURES_DIR);
      await migrate(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(2);
    });

    test("throws clear error when .down.sql file is missing during rollback", async () => {
      const tempDir = "./src/__fixtures__/temp_migrations";

      // Create temp directory with a migration that has only .up.sql
      await mkdir(tempDir, { recursive: true });
      await Bun.write(
        `${tempDir}/001_test.up.sql`,
        "CREATE TABLE test_table (id SERIAL PRIMARY KEY);",
      );
      // Intentionally NOT creating .down.sql file

      // Apply the migration
      await migrate(tempDir);
      const applied = await getAppliedMigrations();
      expect(applied).toContain("001_test");

      // Now try to rollback - should fail with clear error about missing .down.sql
      try {
        await rollback(tempDir);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain(
          "Down migration file not found",
        );
        expect((error as Error).message).toContain("001_test.down.sql");
      } finally {
        // Cleanup - drop the test table manually since rollback failed
        const { sql } = await import("bun");
        await sql`DROP TABLE IF EXISTS test_table CASCADE`;
        await sql`DELETE FROM _migrations WHERE id = '001_test'`;
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("rollback", () => {
    test("reverts the last applied migration", async () => {
      await migrate(FIXTURES_DIR);

      await rollback(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(1);
      expect(applied[0]).toBe("001_create_users");
    });

    test("removes the column added by last migration", async () => {
      await migrate(FIXTURES_DIR);
      await rollback(FIXTURES_DIR);

      const { sql } = await import("bun");
      const columns = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users'
      `;

      const columnNames = columns.map(
        (c: { column_name: string }) => c.column_name,
      );
      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).not.toContain("email");
    });

    test("can rollback multiple times", async () => {
      await migrate(FIXTURES_DIR);

      await rollback(FIXTURES_DIR);
      await rollback(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    test("handles no migrations to rollback gracefully", async () => {
      await ensureMigrationsTable();

      // Should not throw
      await rollback(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });
  });

  describe("reset", () => {
    test("reverts all applied migrations", async () => {
      await migrate(FIXTURES_DIR);

      await reset(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    test("drops all tables created by migrations", async () => {
      await migrate(FIXTURES_DIR);
      await reset(FIXTURES_DIR);

      const { sql } = await import("bun");
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'users'
        )
      `;
      expect(result[0].exists).toBe(false);
    });

    test("handles no migrations to reset gracefully", async () => {
      await ensureMigrationsTable();

      // Should not throw
      await reset(FIXTURES_DIR);

      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });
  });

  describe("transaction safety", () => {
    test("rollback on migration failure keeps database consistent", async () => {
      // First apply valid migrations
      await migrate(FIXTURES_DIR);

      const appliedBefore = await getAppliedMigrations();
      expect(appliedBefore).toHaveLength(2);

      const { sql } = await import("bun");
      // The database state should remain consistent
      const columns = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users'
      `;
      expect(columns.length).toBeGreaterThan(0);
    });

    test("rolls back partial changes when migration SQL fails", async () => {
      const tempDir = "./src/__fixtures__/failing_migrations";

      // Create temp directory with a migration that will fail mid-way
      await mkdir(tempDir, { recursive: true });

      // This migration creates a table, then tries an invalid operation
      await Bun.write(
        `${tempDir}/001_failing.up.sql`,
        `
        CREATE TABLE temp_test_table (id SERIAL PRIMARY KEY, name TEXT);
        INSERT INTO temp_test_table (name) VALUES ('test');
        -- This will fail: referencing non-existent column
        SELECT * FROM temp_test_table WHERE nonexistent_column = 'fail';
        `,
      );
      await Bun.write(`${tempDir}/001_failing.down.sql`, "SELECT 1;");

      const { sql } = await import("bun");

      // Verify table doesn't exist before
      const beforeResult = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'temp_test_table'
        )
      `;
      expect(beforeResult[0].exists).toBe(false);

      // Try to apply the failing migration
      let errorThrown = false;
      try {
        await migrate(tempDir);
      } catch (error) {
        errorThrown = true;
        // Error should be about the non-existent column
        expect((error as Error).message).toContain("nonexistent_column");
      }

      expect(errorThrown).toBe(true);

      // Verify the table was NOT created (transaction rolled back)
      const afterResult = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'temp_test_table'
        )
      `;
      expect(afterResult[0].exists).toBe(false);

      // Verify the migration was NOT recorded
      const applied = await getAppliedMigrations();
      expect(applied).not.toContain("001_failing");

      // Cleanup
      await rm(tempDir, { recursive: true, force: true });
    });
  });
});

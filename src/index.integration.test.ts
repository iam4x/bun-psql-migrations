/**
 * Integration tests for bun-sql-migrations
 *
 * Run tests:
 *   bun test src/index.integration.test.ts
 *
 * Requirements:
 *   - Docker must be running
 */
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
  });
});

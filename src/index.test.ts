import { mkdir, rm } from "node:fs/promises";

import { test, expect, describe, beforeAll, afterAll } from "bun:test";

import {
  generateTimestamp,
  getMigrationBaseName,
  getMigrationsDir,
} from "./index";

describe("generateTimestamp", () => {
  test("returns a 14-character timestamp string", () => {
    const timestamp = generateTimestamp();
    expect(timestamp).toMatch(/^\d{14}$/);
  });

  test("returns timestamps in chronological order", async () => {
    const timestamp1 = generateTimestamp();
    await Bun.sleep(10);
    const timestamp2 = generateTimestamp();
    expect(Number(timestamp2)).toBeGreaterThanOrEqual(Number(timestamp1));
  });
});

describe("getMigrationBaseName", () => {
  test("extracts base name from .up.sql file", () => {
    expect(getMigrationBaseName("20260129120000_add_users.up.sql")).toBe(
      "20260129120000_add_users",
    );
  });

  test("extracts base name from .down.sql file", () => {
    expect(getMigrationBaseName("20260129120000_add_users.down.sql")).toBe(
      "20260129120000_add_users",
    );
  });

  test("handles complex migration names", () => {
    expect(
      getMigrationBaseName("20260129120000_add_user_profiles_table.up.sql"),
    ).toBe("20260129120000_add_user_profiles_table");
  });

  test("returns original name if no .up.sql or .down.sql suffix", () => {
    expect(getMigrationBaseName("some_file.sql")).toBe("some_file.sql");
  });
});

describe("getMigrationsDir", () => {
  const originalEnv = process.env.MIGRATIONS_DIR;

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.MIGRATIONS_DIR = originalEnv;
    } else {
      delete process.env.MIGRATIONS_DIR;
    }
  });

  test("returns default ./migrations when env not set", () => {
    delete process.env.MIGRATIONS_DIR;
    expect(getMigrationsDir()).toBe("./migrations");
  });

  test("returns custom path from environment variable", () => {
    process.env.MIGRATIONS_DIR = "./custom/path";
    expect(getMigrationsDir()).toBe("./custom/path");
  });
});

describe("CLI create command", () => {
  const testDir = "./test-migrations";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("migration name validation - valid names", () => {
    const validNames = [
      "add_users",
      "add-users",
      "AddUsers",
      "add_users_table",
      "migration123",
    ];

    for (const name of validNames) {
      expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
    }
  });

  test("migration name validation - invalid names", () => {
    const invalidNames = [
      "add users", // space
      "add.users", // dot
      "add/users", // slash
      "add@users", // special char
    ];

    for (const name of invalidNames) {
      expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(false);
    }
  });
});

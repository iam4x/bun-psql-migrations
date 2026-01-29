#!/usr/bin/env bun
import { logger } from "./logger";

import {
  generateTimestamp,
  getMigrationsDir,
  migrate,
  rollback,
  reset,
} from "./index";

const HELP_TEXT = `
bun-sql-migrations - Lightweight PostgreSQL migrator for Bun

Usage:
  bun-sql-migrations <command> [options]

Commands:
  init              Create migrations directory
  create <name>     Create a new migration (generates .up.sql and .down.sql files)
  migrate           Apply all pending migrations
  rollback          Rollback the last applied migration
  reset             Rollback all migrations

Environment Variables:
  DATABASE_URL      PostgreSQL connection string (required for migrate/rollback/reset)
  MIGRATIONS_DIR    Migrations directory (default: ./migrations)

Examples:
  bunx bun-sql-migrations init
  bunx bun-sql-migrations create add_users
  DATABASE_URL=postgres://localhost/mydb bunx bun-sql-migrations migrate
`.trim();

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "create":
      await cmdCreate(args);
      break;
    case "migrate":
      await cmdMigrate();
      break;
    case "rollback":
      await cmdRollback();
      break;
    case "reset":
      await cmdReset();
      break;
    case "help":
    case "--help":
    case "-h":
      logger.info(HELP_TEXT);
      break;
    default:
      if (command) {
        logger.error(`Unknown command: ${command}\n`);
      }
      logger.info(HELP_TEXT);
      process.exit(command ? 1 : 0);
  }
}

async function cmdInit(): Promise<void> {
  const migrationsDir = getMigrationsDir();

  const { mkdir, access } = await import("node:fs/promises");

  // Check if directory already exists
  try {
    await access(migrationsDir);
    // If access succeeds, directory exists
    logger.warn(`Migrations directory already exists: ${migrationsDir}`);
    return;
  } catch {
    // Directory doesn't exist, proceed to create it
  }

  await mkdir(migrationsDir, { recursive: true });
  logger.info(`✅ Created migrations directory: ${migrationsDir}`);
}

async function cmdCreate(args: string[]): Promise<void> {
  const name = args[0];

  if (!name) {
    logger.error("Error: Migration name is required");
    logger.error("Usage: bun-sql-migrations create <name>");
    process.exit(1);
  }

  // Validate migration name (alphanumeric, underscores, hyphens only)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    logger.error(
      "Error: Migration name can only contain letters, numbers, underscores, and hyphens",
    );
    process.exit(1);
  }

  const migrationsDir = getMigrationsDir();
  const timestamp = generateTimestamp();
  const baseName = `${timestamp}_${name}`;

  const upFile = `${migrationsDir}/${baseName}.up.sql`;
  const downFile = `${migrationsDir}/${baseName}.down.sql`;

  // Check if migrations directory exists
  const { access } = await import("node:fs/promises");
  try {
    await access(migrationsDir);
  } catch {
    logger.error(
      `Error: Migrations directory does not exist: ${migrationsDir}`,
    );
    logger.error('Run "bun-sql-migrations init" first');
    process.exit(1);
  }

  // Create the migration files
  const upContent = `-- Migration: ${name} (UP)
-- Created at: ${new Date().toISOString()}

`;

  const downContent = `-- Migration: ${name} (DOWN)
-- Created at: ${new Date().toISOString()}

`;

  await Bun.write(upFile, upContent);
  await Bun.write(downFile, downContent);

  logger.info(`✅ Created migration files:`);
  logger.info(`   ${upFile}`);
  logger.info(`   ${downFile}`);
}

async function cmdMigrate(): Promise<void> {
  checkDatabaseUrl();
  await migrate();
}

async function cmdRollback(): Promise<void> {
  checkDatabaseUrl();
  await rollback();
}

async function cmdReset(): Promise<void> {
  checkDatabaseUrl();
  await reset();
}

function checkDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    logger.error("Error: DATABASE_URL environment variable is required");
    logger.error(
      "Example: DATABASE_URL=postgres://user:pass@localhost/db bunx bun-sql-migrations migrate",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ msg: `Error: ${error.message}`, stack: error.stack });
  process.exit(1);
});

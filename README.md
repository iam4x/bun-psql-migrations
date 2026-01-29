# bun-psql-migrations

[![npm version](https://img.shields.io/npm/v/bun-psql-migrations.svg)](https://www.npmjs.com/package/bun-psql-migrations)
[![npm downloads](https://img.shields.io/npm/dm/bun-psql-migrations.svg)](https://www.npmjs.com/package/bun-psql-migrations)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Lightweight PostgreSQL migrator for [Bun](https://bun.sh). Uses Bun's built-in SQL client.

A simple, fast, and reliable database migration tool designed specifically for Bun projects. Manage your PostgreSQL schema changes with timestamp-based migrations, transaction-safe execution, and both CLI and programmatic APIs.

## Table of Contents

- [Features](#features)
- [Why bun-psql-migrations?](#why-bun-psql-migrations)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Environment Variables](#environment-variables)
- [Migration Files](#migration-files)
- [Programmatic API](#programmatic-api)
- [How It Works](#how-it-works)
- [License](#license)

## Features

- Minimal dependencies (only `pino` for logging)
- Simple CLI for managing migrations
- Separate up/down migration files
- Timestamp-based migration naming (no conflicts in teams)
- Transaction-safe migrations
- Programmatic API for custom scripts

## Why bun-psql-migrations?

- **Built for Bun**: Uses Bun's native PostgreSQL client, no external drivers needed
- **Zero config**: Works out of the box with just `DATABASE_URL`
- **Team-friendly**: Timestamp-based naming prevents merge conflicts
- **Lightweight**: Only ~50KB with minimal dependencies

## Installation

```bash
bun add -d bun-psql-migrations
```

## CLI Usage

### Initialize migrations directory

```bash
bunx bun-psql-migrations init
```

Creates a `./migrations` directory in your project.

### Create a new migration

```bash
bunx bun-psql-migrations create add_users
```

Creates two files:
- `migrations/20260129143052_add_users.up.sql`
- `migrations/20260129143052_add_users.down.sql`

### Apply pending migrations

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-psql-migrations migrate
```

### Rollback last migration

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-psql-migrations rollback
```

### Reset all migrations

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-psql-migrations reset
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `MIGRATIONS_DIR` | Path to migrations directory | `./migrations` |

## Migration Files

Migrations use separate files for up and down operations:

**`migrations/20260129143052_add_users.up.sql`**
```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`migrations/20260129143052_add_users.down.sql`**
```sql
DROP TABLE users;
```

## Programmatic API

You can also use the library programmatically:

```typescript
import { migrate, rollback, reset, getPendingMigrations } from "bun-psql-migrations";

// Apply all pending migrations
await migrate();

// Rollback the last migration
await rollback();

// Reset all migrations
await reset();

// Get list of pending migrations
const pending = await getPendingMigrations();
console.log("Pending:", pending);
```

### API Reference

#### `migrate(dir?: string): Promise<void>`
Apply all pending migrations in order.

#### `rollback(dir?: string): Promise<void>`
Rollback the last applied migration.

#### `reset(dir?: string): Promise<void>`
Rollback all migrations in reverse order.

#### `getPendingMigrations(dir?: string): Promise<string[]>`
Get list of migration names that haven't been applied yet.

#### `getAppliedMigrations(): Promise<string[]>`
Get list of migration names that have been applied.

#### `ensureMigrationsTable(): Promise<void>`
Create the `_migrations` tracking table if it doesn't exist.

#### `generateTimestamp(): string`
Generate a timestamp string for migration naming (YYYYMMDDHHmmss).

#### `getMigrationsDir(): string`
Get the migrations directory from `MIGRATIONS_DIR` env var or default.

## How It Works

1. Migrations are tracked in a `_migrations` table in your database
2. Each migration is applied within a transaction
3. The migration name (without `.up.sql`/`.down.sql`) is stored as the ID
4. Migrations are applied in alphabetical order (timestamp prefix ensures correct order)

## License

MIT

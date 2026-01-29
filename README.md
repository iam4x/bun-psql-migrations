# bun-sql-migrations

Lightweight PostgreSQL migrator for [Bun](https://bun.sh). Uses Bun's built-in SQL client.

## Features

- Minimal dependencies (only `pino` for logging)
- Simple CLI for managing migrations
- Separate up/down migration files
- Timestamp-based migration naming (no conflicts in teams)
- Transaction-safe migrations
- Programmatic API for custom scripts

## Installation

```bash
bun add -d bun-sql-migrations
```

## CLI Usage

### Initialize migrations directory

```bash
bunx bun-sql-migrations init
```

Creates a `./migrations` directory in your project.

### Create a new migration

```bash
bunx bun-sql-migrations create add_users
```

Creates two files:
- `migrations/20260129143052_add_users.up.sql`
- `migrations/20260129143052_add_users.down.sql`

### Apply pending migrations

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-sql-migrations migrate
```

### Rollback last migration

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-sql-migrations rollback
```

### Reset all migrations

```bash
DATABASE_URL=postgres://user:pass@localhost/db bunx bun-sql-migrations reset
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
import { migrate, rollback, reset, getPendingMigrations } from "bun-sql-migrations";

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

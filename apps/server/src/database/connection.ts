import { Kysely, SqliteDialect } from "kysely";
import Database from "better-sqlite3";
import { DB } from "./schema.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (!db) {
    const tursoUrl = process.env.TURSO_DB_URL;
    const tursoToken = process.env.TURSO_DB_TOKEN;

    if (tursoUrl && tursoToken) {
      // Production: Turso (libSQL)
      // Using dynamic import to avoid bundling issues
      const { LibsqlDialect } = require("@libsql/kysely-libsql");
      db = new Kysely<DB>({
        dialect: new LibsqlDialect({
          url: tursoUrl,
          authToken: tursoToken,
        }),
      });
      console.log("📦 Using Turso database");
    } else {
      // Local: SQLite
      const dbPath = path.join(__dirname, "../../data/xylkit.db");
      db = new Kysely<DB>({
        dialect: new SqliteDialect({ database: new Database(dbPath) }),
      });
      console.log("📦 Using local SQLite database");
    }
  }
  return db;
}

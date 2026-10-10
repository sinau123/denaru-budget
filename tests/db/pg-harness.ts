import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

// Minimal stand-in for the pieces of Supabase the migrations rely on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
`;

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function createDb() {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  async function createUser(id: string, email = `${id.slice(0, 8)}@example.com`) {
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  }

  /** Runs one statement as the given user (or anonymously when userId is null). */
  async function as<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "";
    await pg.query("select set_config('request.jwt.claims', $1, false)", [claims]);
    await pg.exec(`set role ${userId ? "authenticated" : "anon"}`);
    try {
      const result = await pg.query<T>(sql, params);
      return result.rows;
    } finally {
      await pg.exec("reset role");
    }
  }

  /** Calls an api.* RPC that returns a single jsonb value. */
  async function rpc<T = Record<string, unknown>>(userId: string | null, call: string, params: unknown[] = []) {
    const rows = await as<{ result: T }>(userId, `select ${call} as result`, params);
    return rows[0]?.result as T;
  }

  /** Sets "now" in Asia/Jakarta-independent terms isn't possible in PGlite; tests use real dates. */
  return { pg, createUser, as, rpc, close: () => pg.close() };
}

/** Extracts the RAISE message from a rejected query. */
export async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the query to fail");
}

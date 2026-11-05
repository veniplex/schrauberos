import "server-only";

const isPostgres = /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "");

/**
 * Teilstring-Suche ohne Groß-/Kleinschreibung. SQLite (LIKE) ist für ASCII bereits unabhängig von der
 * Schreibweise; PostgreSQL braucht `mode: "insensitive"`. Das Prisma-Typsystem kennt `mode` nur beim
 * Postgres-Provider – daher hier zentral gekapselt.
 */
export function contains(value: string) {
  return isPostgres ? { contains: value, mode: "insensitive" as const } : { contains: value };
}

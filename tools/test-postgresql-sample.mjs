import { spawnSync } from "node:child_process";

// The explicitly named database route always runs its live proof or holds.
if (!process.env.PENDING_QUERY_POSTGRES_BIN) {
  console.error("Set PENDING_QUERY_POSTGRES_BIN to an existing PostgreSQL 17 bin directory.");
  process.exitCode = 1;
} else {
  const result = spawnSync("uv", [
    "--cache-dir", ".artifacts/uv-cache", "run", "--project",
    "snippets/postgresql-pending-outbox-query/0.1.0", "--locked", "python", "-m",
    "unittest", "discover", "-s", "snippets/postgresql-pending-outbox-query/0.1.0/tests", "-v",
  ], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}

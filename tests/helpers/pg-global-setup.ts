import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Con TEST_DB=postgres levanta un PostgreSQL 16 temporal (el del sistema) para correr
 * las pruebas de integración también contra el driver de producción (node-postgres).
 */
export default function setup() {
  if (process.env.TEST_DB !== "postgres") return () => undefined;
  const bin = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
  const dir = mkdtempSync(path.join(tmpdir(), "consultoria-pg-"));
  chmodSync(dir, 0o777);
  const dataDir = path.join(dir, "data");
  const port = String(55_000 + Math.floor(Math.random() * 5000));
  const asPostgres = (cmd: string, args: string[]) => {
    const isRoot = process.getuid?.() === 0;
    if (isRoot) execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { stdio: "pipe" });
    else execFileSync(cmd, args, { stdio: "pipe" });
  };
  asPostgres(path.join(bin, "initdb"), ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C.UTF-8"]);
  asPostgres(path.join(bin, "pg_ctl"), [
    "-D",
    dataDir,
    "-o",
    `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
    "-l",
    path.join(dir, "log.txt"),
    "-w",
    "start",
  ]);
  process.env.TEST_PG_ADMIN_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  return () => {
    try {
      asPostgres(path.join(bin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

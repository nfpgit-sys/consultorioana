import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de punta a punta contra el build de producción (`next build && next start`),
 * con clave de acceso real, base PostgreSQL embebida en una carpeta temporal y archivos locales.
 * La IA no se usa: el asistente funciona en modo básico (las pruebas no gastan créditos).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "consultoria-e2e-"));
const PORT = 3100;

export const E2E_CLAVE = "clave-de-prueba-e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  },
  projects: [
    { name: "computadora", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/salud`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PGLITE_DIR: path.join(dataDir, "db"),
      ARCHIVOS_DIR: path.join(dataDir, "archivos"),
      CLAVE_CONSULTORIO: E2E_CLAVE,
      SESSION_SECRET: "secreto-de-sesion-solo-para-pruebas-e2e",
      ANTHROPIC_API_KEY: "",
    },
  },
});

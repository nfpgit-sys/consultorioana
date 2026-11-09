import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLoginAllowed, MAX_FAILURES_GLOBAL, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { createDeviceToken, createSessionToken, verifyDeviceToken, verifySessionToken } from "@/lib/auth/session";
import type { Database } from "@/lib/db/types";
import { createTestDb } from "../helpers/db";

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

const fail = (ip: string, device: string | null, n: number) => Promise.all(Array.from({ length: n }, () => recordLoginAttempt(ip, false, device, db)));

describe("límite de intentos de clave (error 6 de la auditoría)", () => {
  it("10 errores desde la IP del consultorio bloquean a un navegador nuevo, no a un dispositivo de confianza", async () => {
    await fail("200.1.1.1", null, 10);
    const nuevo = await checkLoginAllowed("200.1.1.1", null, db);
    expect(nuevo).toMatch(/Probá de nuevo en (1[0-5]|[1-9]) minutos?/);
    expect(await checkLoginAllowed("200.1.1.1", "dispositivo-recepcion", db)).toBeNull();
    expect(await checkLoginAllowed("200.9.9.9", null, db)).toBeNull();
  });

  it("los errores de un dispositivo cuentan solo para ese dispositivo", async () => {
    await fail("200.2.2.2", "dispositivo-consultorio-1", 10);
    expect(await checkLoginAllowed("200.2.2.2", "dispositivo-consultorio-1", db)).toMatch(/Demasiados intentos/);
    expect(await checkLoginAllowed("200.2.2.2", "dispositivo-consultorio-2", db)).toBeNull();
    // Y no suman al límite de la IP para navegadores nuevos.
    expect(await checkLoginAllowed("200.2.2.2", null, db)).toBeNull();
  });

  it("un ataque distribuido (límite global) no bloquea a los dispositivos de confianza", async () => {
    await Promise.all(Array.from({ length: MAX_FAILURES_GLOBAL }, (_, i) => recordLoginAttempt(`10.0.${Math.floor(i / 9)}.${i % 9}`, false, null, db)));
    expect(await checkLoginAllowed("181.5.5.5", null, db)).toMatch(/Demasiados intentos/);
    expect(await checkLoginAllowed("181.5.5.5", "dispositivo-recepcion", db)).toBeNull();
  });
});

describe("cookie de dispositivo de confianza", () => {
  const cfg = { clave: "clave-de-prueba", sessionSecret: "secreto-de-prueba-0123456789" };

  it("se verifica con la firma y no sirve como sesión", async () => {
    const { token, id } = await createDeviceToken(cfg);
    expect(await verifyDeviceToken(token, cfg)).toBe(id);
    expect(await verifySessionToken(token, cfg)).toBe(false);
    const forged = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
    expect(await verifyDeviceToken(forged, cfg)).toBeNull();
    expect(await verifyDeviceToken(token, { ...cfg, sessionSecret: "otro-secreto-0123456789" })).toBeNull();
  });

  it("una sesión no sirve como cookie de dispositivo", async () => {
    expect(await verifyDeviceToken(await createSessionToken(cfg), cfg)).toBeNull();
  });

  it("vence al año", async () => {
    const { token } = await createDeviceToken(cfg, Date.now() - 366 * 24 * 3600 * 1000);
    expect(await verifyDeviceToken(token, cfg)).toBeNull();
  });
});

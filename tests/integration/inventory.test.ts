import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { DomainError } from "@/lib/services/errors";
import {
  adjustStock,
  listMovements,
  writeOffLot,
  planReversal,
  previewMovements,
  registerMovements,
  reverseMovement,
} from "@/lib/services/movements";
import {
  addPresentation,
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "@/lib/services/products";
import { createTestDb, manual, texto, usingPostgres } from "../helpers/db";

let db: Database;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

async function newProduct(name: string, opts: Partial<Parameters<typeof createProduct>[1]> = {}) {
  const out = await createProduct(db, { name, baseUnit: "unidad", minStock: 0, ...opts }, manual);
  return out.result.productId;
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error(`Se esperaba el error ${code}`);
}

describe("productos", () => {
  it("crea un producto con stock inicial y registra el movimiento", async () => {
    const id = await newProduct("Jeringa descartable 5 ml", { initialStock: 5, minStock: 2, unitCost: 120, category: "Descartables" });
    const product = await getProduct(db, id);
    expect(product).toMatchObject({ currentStock: 5, minStock: 2, unitCost: 120, status: "ok", stockValue: 600 });
    const { movements } = await listMovements(db, { productId: id });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ kind: "stock_inicial", quantity: 5, stockBefore: 0, stockAfter: 5, source: "manual" });
  });

  it("impide duplicados exactos y advierte nombres casi iguales", async () => {
    await expectDomainError(createProduct(db, { name: "jeringas descartables 5ml", baseUnit: "unidad" }, manual), "producto_duplicado");
    await newProduct("Guantes de látex talle M");
    const err = await expectDomainError(createProduct(db, { name: "Guante latex talle M.", baseUnit: "unidad" }, manual), "producto_duplicado");
    expect(err.message).toContain("Guantes de látex talle M");
    await expectDomainError(createProduct(db, { name: "Guantes de látex M", baseUnit: "unidad" }, manual), "producto_similar");
    const ok = await createProduct(db, { name: "Guantes de látex M", baseUnit: "unidad", acknowledgeSimilar: true }, manual);
    expect(ok.result.productId).toBeTruthy();
  });

  it("no permite cambiar la unidad base si hay movimientos", async () => {
    const id = await newProduct("Alginato", { baseUnit: "g", initialStock: 450 });
    await expectDomainError(updateProduct(db, id, { baseUnit: "kg" }, manual), "unidad_bloqueada");
    const sinMov = await newProduct("Cemento provisorio", { baseUnit: "g" });
    await updateProduct(db, sinMov, { baseUnit: "kg", minStock: 1 }, manual);
    expect((await getProduct(db, sinMov))?.baseUnit).toBe("kg");
  });

  it("archiva sin borrar el historial", async () => {
    const id = await newProduct("Fresa redonda", { initialStock: 3 });
    await archiveProduct(db, id, "Ya no se usa", manual);
    expect((await listProducts(db)).some((p) => p.id === id)).toBe(false);
    expect((await listProducts(db, { onlyArchived: true })).some((p) => p.id === id)).toBe(true);
    expect((await listMovements(db, { productId: id })).movements).toHaveLength(1);
    await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 1, kind: "consumo" }] }, manual),
      "operacion_invalida",
    );
  });
});

describe("consumos e ingresos", () => {
  it("el ejemplo del pedido: hay 5 jeringas, se gastan 3, quedan 2", async () => {
    const id = await newProduct("Jeringa insulina", { initialStock: 5 });
    const out = await registerMovements(db, { items: [{ productId: id, quantity: 3, kind: "consumo" }] }, texto());
    expect(out.duplicate).toBe(false);
    expect((await getProduct(db, id))?.currentStock).toBe(2);
    const { movements } = await listMovements(db, { productId: id });
    expect(movements[0]).toMatchObject({ kind: "consumo", quantity: -3, stockBefore: 5, stockAfter: 2, source: "texto" });
  });

  it("nunca deja el stock en negativo", async () => {
    const id = await newProduct("Eyector de saliva", { initialStock: 2 });
    const err = await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 3, kind: "consumo" }] }, manual),
      "operacion_invalida",
    );
    expect(err.message).toContain("No hay stock suficiente");
    expect((await getProduct(db, id))?.currentStock).toBe(2);
  });

  it("descuenta en conjunto varias líneas del mismo producto", async () => {
    const id = await newProduct("Baberos", { initialStock: 10 });
    await expectDomainError(
      registerMovements(
        db,
        {
          items: [
            { productId: id, quantity: 6, kind: "consumo" },
            { productId: id, quantity: 6, kind: "consumo" },
          ],
        },
        manual,
      ),
      "operacion_invalida",
    );
    expect((await getProduct(db, id))?.currentStock).toBe(10);
  });

  it("convierte presentaciones definidas y rechaza las no definidas", async () => {
    const id = await newProduct("Guantes nitrilo S");
    await addPresentation(db, id, { name: "caja", factor: 100 }, manual);
    await registerMovements(db, { items: [{ productId: id, quantity: 2, unit: "cajas", kind: "ingreso" }] }, manual);
    expect((await getProduct(db, id))?.currentStock).toBe(200);
    const err = await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 1, unit: "paquete", kind: "ingreso" }] }, manual),
      "operacion_invalida",
    );
    expect(err.message).toContain("paquete");
    await expectDomainError(addPresentation(db, id, { name: "gramos", factor: 3 }, manual), "presentacion_invalida");
  });

  it("convierte unidades físicas (kg -> g) pero no mezcla magnitudes", async () => {
    const id = await newProduct("Yeso piedra", { baseUnit: "g" });
    await registerMovements(db, { items: [{ productId: id, quantity: 1.5, unit: "kg", kind: "ingreso" }] }, manual);
    expect((await getProduct(db, id))?.currentStock).toBe(1500);
    await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 1, unit: "ml", kind: "consumo" }] }, manual),
      "operacion_invalida",
    );
  });

  it("advierte posibles duplicados y exige confirmación explícita", async () => {
    const id = await newProduct("Gasas", { initialStock: 50 });
    await registerMovements(db, { items: [{ productId: id, quantity: 4, kind: "consumo" }] }, manual);
    const preview = await previewMovements(db, { items: [{ productId: id, quantity: 4, kind: "consumo" }] });
    expect(preview.warnings.map((w) => w.code)).toContain("posible_duplicado");
    const err = await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 4, kind: "consumo" }] }, manual),
      "requiere_confirmacion",
    );
    expect(JSON.stringify(err.details)).toContain("posible_duplicado");
    await registerMovements(db, { items: [{ productId: id, quantity: 4, kind: "consumo" }], acknowledgeWarnings: true }, manual);
    expect((await getProduct(db, id))?.currentStock).toBe(42);
  });

  it("pide confirmación si el stock queda en cero", async () => {
    const id = await newProduct("Hilo de sutura", { initialStock: 2 });
    await expectDomainError(
      registerMovements(db, { items: [{ productId: id, quantity: 2, kind: "consumo" }] }, manual),
      "requiere_confirmacion",
    );
    await registerMovements(db, { items: [{ productId: id, quantity: 2, kind: "consumo" }], acknowledgeWarnings: true }, manual);
    expect((await getProduct(db, id))?.status).toBe("agotado");
  });

  it("la misma clave de idempotencia no duplica el movimiento", async () => {
    const id = await newProduct("Algodón", { initialStock: 20 });
    const key = "confirmacion-123";
    const a = await registerMovements(db, { items: [{ productId: id, quantity: 1, kind: "consumo" }] }, texto(key));
    const b = await registerMovements(db, { items: [{ productId: id, quantity: 1, kind: "consumo" }] }, texto(key));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.operationId).toBe(a.operationId);
    expect((await getProduct(db, id))?.currentStock).toBe(19);
  });
});

describe("correcciones", () => {
  it("revierte un movimiento con otro de signo contrario, una sola vez", async () => {
    const id = await newProduct("Lidocaína 2%", { initialStock: 10 });
    const out = await registerMovements(db, { items: [{ productId: id, quantity: 3, kind: "consumo" }] }, manual);
    const movementId = out.result.movements[0].id;
    await reverseMovement(db, { movementId, reason: "Lo cargué por error" }, manual);
    expect((await getProduct(db, id))?.currentStock).toBe(10);
    const { movements } = await listMovements(db, { productId: id });
    expect(movements.map((m) => m.kind)).toEqual(["reversion", "consumo", "stock_inicial"]);
    expect(movements[1].reversedByNumber).toBe(movements[0].number);
    expect((await planReversal(db, movementId)).ok).toBe(false);
    await expectDomainError(reverseMovement(db, { movementId, reason: "otra vez" }, manual), "reversion_invalida");
    await expectDomainError(reverseMovement(db, { movementId: movements[0].id, reason: "revertir la reversión" }, manual), "reversion_invalida");
  });

  it("ajusta el stock a una cantidad contada, con motivo", async () => {
    const id = await newProduct("Rollos de algodón", { initialStock: 30 });
    await expectDomainError(adjustStock(db, { productId: id, newStock: 30, reason: "conteo" }, manual), "operacion_invalida");
    await expectDomainError(adjustStock(db, { productId: id, newStock: 3, reason: "conteo mensual" }, manual), "requiere_confirmacion");
    await adjustStock(db, { productId: id, newStock: 28, reason: "conteo mensual" }, manual);
    const { movements } = await listMovements(db, { productId: id });
    expect(movements[0]).toMatchObject({ kind: "ajuste", quantity: -2, stockAfter: 28, reason: "conteo mensual" });
  });
});

describe("lotes y vencimientos", () => {
  it("descuenta primero el lote que vence antes", async () => {
    const id = await newProduct("Anestesia articaína", {
      tracksExpiry: true,
      initialStock: 10,
      initialLotCode: "L-2",
      initialExpiresOn: "2027-06-30",
    });
    await registerMovements(
      db,
      { items: [{ productId: id, quantity: 5, kind: "ingreso", lotCode: "L-1", expiresOn: "2027-01-31" }] },
      manual,
    );
    expect((await getProduct(db, id))?.currentStock).toBe(15);
    await registerMovements(db, { items: [{ productId: id, quantity: 7, kind: "consumo" }] }, manual);
    const lots = await db.query<{ lot_code: string; quantity: string }>(
      "select lot_code, quantity from lots where product_id = $1 order by expires_on",
      [id],
    );
    expect(lots.map((l) => [l.lot_code, Number(l.quantity)])).toEqual([
      ["L-1", 0],
      ["L-2", 8],
    ]);
    const { movements } = await listMovements(db, { productId: id, kind: "consumo" });
    expect(movements.map((m) => [m.lotCode, m.quantity])).toEqual([
      ["L-2", -2],
      ["L-1", -5],
    ]);
    expect((await getProduct(db, id))?.currentStock).toBe(8);
    await expectDomainError(adjustStock(db, { productId: id, newStock: 5, reason: "conteo" }, manual), "operacion_invalida");
  });
});

describe("baja por vencimiento", () => {
  it("da de baja un lote vencido con un movimiento de tipo vencimiento", async () => {
    const id = await newProduct("Adhesivo dental", {
      tracksExpiry: true,
      initialStock: 3,
      initialLotCode: "V-1",
      initialExpiresOn: "2020-01-31",
    });
    const [lot] = await db.query<{ id: string }>("select id from lots where product_id = $1", [id]);
    await writeOffLot(db, { lotId: lot.id }, manual);
    expect((await getProduct(db, id))?.currentStock).toBe(0);
    const { movements } = await listMovements(db, { productId: id, kind: "vencimiento" });
    expect(movements[0]).toMatchObject({ quantity: -3, lotCode: "V-1" });
    await expectDomainError(writeOffLot(db, { lotId: lot.id }, manual), "lote_vacio");
  });
});

describe.runIf(usingPostgres())("concurrencia (PostgreSQL real)", () => {
  it("dos consumos simultáneos no pueden dejar el stock negativo", async () => {
    const id = await newProduct("Puntas de papel", { initialStock: 5 });
    const attempt = () =>
      registerMovements(db, { items: [{ productId: id, quantity: 3, kind: "consumo" }], acknowledgeWarnings: true }, manual).then(
        () => "ok",
        (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
      );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.sort()).toEqual(["ok", "operacion_invalida"]);
    expect((await getProduct(db, id))?.currentStock).toBe(2);
  });

  it("la misma clave enviada en paralelo se ejecuta una sola vez", async () => {
    const id = await newProduct("Vasos descartables", { initialStock: 100 });
    const ctx = texto("doble-click-paralelo");
    const results = await Promise.all([
      registerMovements(db, { items: [{ productId: id, quantity: 5, kind: "consumo" }] }, ctx),
      registerMovements(db, { items: [{ productId: id, quantity: 5, kind: "consumo" }] }, ctx),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect((await getProduct(db, id))?.currentStock).toBe(95);
  });
});

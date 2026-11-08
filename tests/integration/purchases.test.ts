import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { DomainError } from "@/lib/services/errors";
import { createExpense, listExpenses, voidExpense } from "@/lib/services/expenses";
import { listMovements, registerMovements } from "@/lib/services/movements";
import { addPresentation, createProduct, getProduct } from "@/lib/services/products";
import {
  completePurchasePrices,
  createPurchase,
  getPurchase,
  listPurchases,
  normalizeDocNumber,
  previewPurchase,
  voidPurchase,
} from "@/lib/services/purchases";
import { isValidCuit, listSuppliers } from "@/lib/services/suppliers";
import { todayAR } from "@/lib/domain/format";
import { createTestDb, manual } from "../helpers/db";

let db: Database;
let pasta: string;
let guantes: string;
const today = todayAR();

beforeAll(async () => {
  db = await createTestDb();
  pasta = (await createProduct(db, { name: "Pasta profiláctica", baseUnit: "unidad", initialStock: 2, unitCost: 1000 }, manual)).result
    .productId;
  guantes = (await createProduct(db, { name: "Guantes de látex M", baseUnit: "unidad" }, manual)).result.productId;
  await addPresentation(db, guantes, { name: "caja", factor: 100 }, manual);
});

afterAll(async () => {
  await db?.close();
});

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error(`Se esperaba ${code}`);
}

describe("compras", () => {
  it("registra una compra con varias líneas, presentaciones, proveedor nuevo e impuestos prorrateados", async () => {
    const out = await createPurchase(
      db,
      {
        supplierName: "Dental Sur SRL",
        supplierCuit: "30-71234567-1",
        purchaseDate: today,
        docType: "factura_a",
        docNumber: "0002-00004567",
        items: [
          { productId: pasta, quantity: 5, unitPrice: 1000 },
          { productId: guantes, quantity: 2, unit: "cajas", lineTotal: 10000 },
          { productId: null, description: "Envío", quantity: 1, lineTotal: 1000 },
        ],
        taxAmount: 3360,
      },
      manual,
    );
    expect(out.result).toMatchObject({ status: "registrada", total: 19360 });
    const detail = await getPurchase(db, out.result.purchaseId);
    expect(detail).toMatchObject({ supplierName: "Dental Sur SRL", docNumber: "00002-00004567", subtotal: 16000, total: 19360 });
    expect(detail?.items).toHaveLength(3);
    // 2 + 5 pastas; 200 guantes
    expect((await getProduct(db, pasta))?.currentStock).toBe(7);
    expect((await getProduct(db, guantes))?.currentStock).toBe(200);
    // Costo efectivo con IVA: factor 19360/16000 = 1.21
    // pasta: 1000 × 1.21 = 1210 por unidad; promedio ponderado con 2 unidades a 1000 -> (2×1000 + 5×1210)/7 = 1150
    expect((await getProduct(db, pasta))?.unitCost).toBe(1150);
    expect((await getProduct(db, guantes))?.unitCost).toBe(60.5);
    const { movements } = await listMovements(db, { purchaseId: out.result.purchaseId });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.kind === "compra")).toBe(true);
    expect((await listSuppliers(db)).map((s) => s.name)).toContain("Dental Sur SRL");
  });

  it("no registra dos veces el mismo comprobante del mismo proveedor", async () => {
    const err = await expectCode(
      createPurchase(
        db,
        {
          supplierName: "dental sur srl",
          purchaseDate: today,
          docType: "factura_a",
          docNumber: "2-4567",
          items: [{ productId: pasta, quantity: 1, unitPrice: 1000 }],
        },
        manual,
      ),
      "compra_invalida",
    );
    expect(err.message).toContain("ya está registrado");
  });

  it("queda pendiente si falta el precio y luego se completa", async () => {
    const out = await createPurchase(db, { purchaseDate: today, items: [{ productId: pasta, quantity: 3 }] }, manual);
    expect(out.result.status).toBe("pendiente_precio");
    expect((await getProduct(db, pasta))?.currentStock).toBe(10);
    const detail = await getPurchase(db, out.result.purchaseId);
    await completePurchasePrices(db, out.result.purchaseId, { items: [{ itemId: detail!.items[0].id, lineTotal: 3600 }] }, manual);
    expect(await getPurchase(db, out.result.purchaseId)).toMatchObject({ status: "registrada", total: 3600 });
  });

  it("advierte cuando el total no coincide con las líneas", async () => {
    const preview = await previewPurchase(db, {
      purchaseDate: today,
      items: [{ productId: pasta, quantity: 1, lineTotal: 1000 }],
      total: 5000,
    });
    expect(preview.warnings.map((w) => w.code)).toContain("total_no_coincide");
    await expectCode(
      createPurchase(db, { purchaseDate: today, items: [{ productId: pasta, quantity: 1, lineTotal: 1000 }], total: 5000 }, manual),
      "requiere_confirmacion",
    );
  });

  it("no acepta fechas futuras", async () => {
    await expect(
      createPurchase(db, { purchaseDate: "2999-01-01", items: [{ productId: pasta, quantity: 1, lineTotal: 1 }] }, manual),
    ).rejects.toThrow();
  });

  it("anula una compra revirtiendo su stock, salvo que ya se haya consumido", async () => {
    const out = await createPurchase(
      db,
      { purchaseDate: today, items: [{ productId: guantes, quantity: 1, unit: "caja", lineTotal: 6000 }] },
      manual,
    );
    expect((await getProduct(db, guantes))?.currentStock).toBe(300);
    await voidPurchase(db, out.result.purchaseId, "Cargada dos veces", manual);
    expect((await getProduct(db, guantes))?.currentStock).toBe(200);
    expect((await getPurchase(db, out.result.purchaseId))?.status).toBe("anulada");
    await expectCode(voidPurchase(db, out.result.purchaseId, "otra vez", manual), "ya_anulada");

    const second = await createPurchase(
      db,
      { purchaseDate: today, items: [{ productId: guantes, quantity: 1, unit: "caja", lineTotal: 6000 }] },
      manual,
    );
    await registerMovements(db, { items: [{ productId: guantes, quantity: 250, kind: "consumo" }], acknowledgeWarnings: true }, manual);
    const err = await expectCode(voidPurchase(db, second.result.purchaseId, "error", manual), "stock_insuficiente");
    expect(err.message).toContain("ya se consumió");
  });

  it("lista compras con filtros", async () => {
    const list = await listPurchases(db, { from: today, to: today });
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((p) => p.status === "anulada")).toBe(true);
  });
});

describe("gastos generales", () => {
  it("registra, advierte duplicados y anula", async () => {
    const a = await createExpense(db, { expenseDate: today, category: "Luz", description: "Factura Edesur", amount: 45000 }, manual);
    await expectCode(
      createExpense(db, { expenseDate: today, category: "Luz", description: "Edesur", amount: 45000 }, manual),
      "requiere_confirmacion",
    );
    await voidExpense(db, a.result.expenseId, "Era del mes pasado", manual);
    expect((await listExpenses(db)).some((e) => e.id === a.result.expenseId)).toBe(false);
    expect((await listExpenses(db, { includeVoided: true })).find((e) => e.id === a.result.expenseId)?.status).toBe("anulado");
  });
});

describe("validaciones auxiliares", () => {
  it("valida CUIT con dígito verificador", () => {
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("20-12345678-5")).toBe(false);
    expect(isValidCuit("123")).toBe(false);
  });

  it("normaliza números de comprobante", () => {
    expect(normalizeDocNumber("A-0001-00001234")).toBe("00001-00001234");
    expect(normalizeDocNumber("1-1234")).toBe("00001-00001234");
    expect(normalizeDocNumber("ticket 99")).toBe("TICKET99");
  });
});

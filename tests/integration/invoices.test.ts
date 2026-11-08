import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { buildReview } from "@/lib/invoices/review";
import type { InvoiceExtraction } from "@/lib/invoices/schema";
import { createDocument, getDocument, saveExtraction } from "@/lib/services/documents";
import { addPresentation, createProduct, getProduct } from "@/lib/services/products";
import { createPurchase } from "@/lib/services/purchases";
import { todayAR } from "@/lib/domain/format";
import { createTestDb, manual } from "../helpers/db";

let db: Database;
let jeringa: string;
let guantes: string;

const extraction = (overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction => ({
  tipo_documento: "factura_a",
  es_compra_de_insumos: true,
  categoria_gasto_sugerida: null,
  proveedor_nombre: "Distribuidora Odonto SA",
  proveedor_cuit: "30-71234567-1",
  fecha: todayAR(),
  numero: "0003-00012345",
  moneda: "ARS",
  lineas: [
    {
      descripcion: "JER DESC 5ML C/AG 21G X100",
      nombre_normalizado: "Jeringa descartable 5 ml con aguja 21G",
      cantidad: 2,
      unidad: "caja",
      contenido_por_unidad: 100,
      unidad_contenido: "unidades",
      precio_unitario: 8000,
      importe: 16000,
      lote: null,
      vencimiento: null,
      confianza: "alta",
    },
    {
      descripcion: "GUANTE LATEX M CJ X100",
      nombre_normalizado: "Guantes de látex talle M",
      cantidad: 1,
      unidad: "caja",
      contenido_por_unidad: 100,
      unidad_contenido: "unidades",
      precio_unitario: 9000,
      importe: 9000,
      lote: null,
      vencimiento: null,
      confianza: "alta",
    },
    {
      descripcion: "HILO DENTAL 50M",
      nombre_normalizado: "Hilo dental 50 m",
      cantidad: 3,
      unidad: "unidad",
      contenido_por_unidad: null,
      unidad_contenido: null,
      precio_unitario: 1500,
      importe: 4500,
      lote: null,
      vencimiento: null,
      confianza: "media",
    },
  ],
  subtotal: 29500,
  iva: 6195,
  otros_impuestos: null,
  descuentos: null,
  total: 35695,
  precios_incluyen_iva: false,
  legibilidad: "buena",
  observaciones: null,
  ...overrides,
});

async function newDoc(ex: InvoiceExtraction) {
  const id = randomUUID();
  await createDocument(db, [{ fileName: "f.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: randomUUID(), storage: "none", storageKey: null }], { source: "factura" }, id);
  await saveExtraction(db, id, { data: ex, model: "simulado" });
  return (await getDocument(db, id))!;
}

beforeAll(async () => {
  db = await createTestDb();
  jeringa = (await createProduct(db, { name: "Jeringa descartable 5 ml", baseUnit: "unidad" }, manual)).result.productId;
  guantes = (await createProduct(db, { name: "Guantes de látex talle M", baseUnit: "unidad" }, manual)).result.productId;
  await addPresentation(db, guantes, { name: "caja", factor: 100 }, manual);
});

afterAll(async () => {
  await db?.close();
});

describe("revisión de facturas", () => {
  it("relaciona líneas con el catálogo, sugiere unidades y propone productos nuevos", async () => {
    const doc = await newDoc(extraction());
    const review = (await buildReview(db, doc))!;
    expect(review.kind).toBe("compra");
    expect(review.supplier).toMatchObject({ name: "Distribuidora Odonto SA", cuit: "30712345671", cuitValid: true, existingId: null });
    const [l1, l2, l3] = review.lines;
    expect(l1.match.productId).toBe(jeringa);
    // La jeringa no tiene presentación "caja": se convierte según la factura y se avisa.
    expect(l1.suggested).toMatchObject({ quantity: 200, unit: "" });
    expect(l1.suggested.note).toContain("200");
    expect(l2.match.productId).toBe(guantes);
    expect(l2.suggested).toMatchObject({ quantity: 1, unit: "caja", note: null });
    expect(l3.match.status).toBe("sin_coincidencia");
    expect(l3.newProduct).toMatchObject({ name: "Hilo dental 50 m", baseUnit: "unidad" });
    expect(review.sumLines).toBe(29500);
    expect(review.duplicate).toBeNull();
  });

  it("al registrar aprende los alias y la próxima factura del proveedor coincide segura", async () => {
    const doc = await newDoc(extraction());
    const out = await createPurchase(
      db,
      {
        supplierName: "Distribuidora Odonto SA",
        supplierCuit: "30712345671",
        purchaseDate: todayAR(),
        docType: "factura_a",
        docNumber: "0003-00012345",
        documentId: doc.id,
        items: [
          { productId: jeringa, quantity: 200, lineTotal: 16000, description: "JER DESC 5ML C/AG 21G X100", learnAlias: "JER DESC 5ML C/AG 21G X100" },
          { productId: guantes, quantity: 1, unit: "caja", lineTotal: 9000, description: "GUANTE LATEX M CJ X100", learnAlias: "GUANTE LATEX M CJ X100" },
          { productId: null, description: "HILO DENTAL 50M", quantity: 3, lineTotal: 4500 },
        ],
        taxAmount: 6195,
        total: 35695,
      },
      { source: "factura" },
    );
    expect(out.result.status).toBe("registrada");
    expect((await getDocument(db, doc.id))?.status).toBe("registrado");
    expect((await getProduct(db, jeringa))?.currentStock).toBe(200);
    expect((await getProduct(db, guantes))?.currentStock).toBe(100);

    // Mismo comprobante otra vez: se detecta como duplicado.
    const again = await newDoc(extraction());
    const review = (await buildReview(db, again))!;
    expect(review.duplicate).toMatchObject({ kind: "compra" });
    expect(review.supplier.existingId).not.toBeNull();

    // Otra factura del mismo proveedor: los alias aprendidos dan coincidencia segura.
    const next = await newDoc(extraction({ numero: "0003-00012399" }));
    const r2 = (await buildReview(db, next))!;
    expect(r2.duplicate).toBeNull();
    expect(r2.lines[0].match).toMatchObject({ status: "segura", productId: jeringa, via: "alias" });
    expect(r2.lines[1].match).toMatchObject({ status: "segura", productId: guantes });
  });

  it("detecta gastos generales y fechas imposibles", async () => {
    const doc = await newDoc(
      extraction({
        es_compra_de_insumos: false,
        categoria_gasto_sugerida: "Luz",
        fecha: "2999-01-01",
        moneda: "USD",
        lineas: [],
        numero: null,
      }),
    );
    const review = (await buildReview(db, doc))!;
    expect(review.kind).toBe("gasto");
    expect(review.date).toBeNull();
    expect(review.dateWarning).toContain("posterior a hoy");
    expect(review.currencyWarning).toContain("USD");
  });
});

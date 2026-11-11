import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { buildReview } from "@/lib/invoices/review";
import { coerceExtraction, type InvoiceExtraction } from "@/lib/invoices/schema";
import { createDocument, getDocument, saveExtraction } from "@/lib/services/documents";
import { addPresentation, createProduct, getProduct } from "@/lib/services/products";
import { createPurchase } from "@/lib/services/purchases";
import { todayAR } from "@/lib/domain/format";
import { createTestDb, manual } from "../helpers/db";

let db: Database;
let jeringa: string;
let guantes: string;

const extraction = (overrides: Record<string, unknown> = {}): InvoiceExtraction =>
  coerceExtraction({
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
    expect(review.issuedOn).toBe("2999-01-01");
    expect(review.dateWarning).toContain("posterior a hoy");
    expect(review.currencyWarning).toContain("USD");
  });
});

/**
 * Las tres facturas de alquiler que no se pudieron procesar, tal como las estructura el lector
 * (formato sin letra, sin CUIT del emisor, tres conceptos, período y vencimiento).
 */
const RENTALS = [
  { emisor: "Grupo Inmobiliario Rivadavia", numero: "0002-001273", fecha: "2026-11-03", vence: "2026-11-10", periodo: "2026-11", cliente: "María González", dni: "38765432", inmueble: "Alsina 567, Bahía Blanca", conceptos: [["Alquiler mensual", 350000], ["Expensas", 70000], ["Servicios (luz)", 22300]], total: 442300 },
  { emisor: "Inmobiliaria del Sur", numero: "0001-004782", fecha: "2026-10-15", vence: "2026-10-20", periodo: "2026-10", cliente: "Juan Pérez", dni: "42345678", inmueble: "Av. Colón 1234, Mar del Plata", conceptos: [["Alquiler mensual", 420000], ["Expensas", 85000], ["Servicios (agua)", 12500]], total: 517500 },
  { emisor: "RentAR Soluciones Inmobiliarias", numero: "0003-007612", fecha: "2026-11-28", vence: "2026-12-05", periodo: "2026-11", cliente: "Diego Fernández", dni: "45678901", inmueble: "Bv. Illia 987, Córdoba", conceptos: [["Alquiler mensual", 380000], ["Expensas", 75000], ["Servicios (gas)", 18750]], total: 473750 },
] as const;

const rentalExtraction = (r: (typeof RENTALS)[number]) =>
  coerceExtraction({
    tipo_documento: "factura",
    descripcion_comprobante: "Factura de alquiler",
    numero: r.numero,
    fecha: r.fecha,
    fecha_vencimiento: r.vence,
    periodo: r.periodo,
    proveedor_nombre: r.emisor,
    proveedor_cuit: null,
    receptor_nombre: r.cliente,
    receptor_documento: r.dni,
    receptor_domicilio: r.inmueble,
    es_compra_de_insumos: false,
    categoria_gasto_sugerida: "Alquiler",
    lineas: r.conceptos.map(([descripcion, importe]) => ({ descripcion, tipo_linea: "servicio", cantidad: null, precio_unitario: null, importe, confianza: "alta" })),
    total: r.total,
    precios_incluyen_iva: true,
    legibilidad: "buena",
  });

describe("facturas de alquiler (formato sin letra ni CUIT)", () => {
  it.each(RENTALS.map((r) => [r.emisor, r] as const))("%s: se revisa como gasto con todos los datos y controles", async (_name, r) => {
    const doc = await newDoc(rentalExtraction(r));
    const review = (await buildReview(db, doc))!;
    expect(review.kind).toBe("gasto");
    expect(review.docType).toBe("otro"); // la app registra «factura sin letra» como otro comprobante
    expect(review.docNumber).toBeTruthy();
    expect(review.sumLines).toBe(r.total);
    expect(review.totals.total).toBe(r.total);
    expect(review.supplier).toMatchObject({ name: r.emisor, cuit: null, cuitValid: true });
    expect(review.issuedOn).toBe(r.fecha);
    expect(review.notes).toContain("Factura de alquiler");
    expect(review.notes).toContain(`Período ${r.periodo.slice(5)}/${r.periodo.slice(0, 4)}`);
    expect(review.notes).toContain("Vence");
    expect(review.notes).toContain(r.inmueble);
    expect(review.checks).toContainEqual(expect.objectContaining({ level: "ok", message: expect.stringContaining("coincide con el total") }));
    expect(review.checks.filter((c) => c.level === "error")).toEqual([]);
    if (r.fecha > todayAR()) {
      // Emisión futura (28/11 cuando hoy es antes): se muestra, se avisa y no se usa para registrar.
      expect(review.date).toBeNull();
      expect(review.dateWarning).toContain("posterior a hoy");
      expect(review.doubtful).toContain("fecha");
    } else {
      expect(review.date).toBe(r.fecha);
    }
  });
});

describe("compatibilidad con lecturas guardadas por la versión anterior", () => {
  it("un comprobante analizado antes de este cambio se sigue pudiendo revisar", async () => {
    const id = randomUUID();
    await createDocument(db, [{ fileName: "viejo.jpg", mimeType: "image/jpeg", sizeBytes: 10, sha256: randomUUID(), storage: "none", storageKey: null }], { source: "factura" }, id);
    const v1 = {
      tipo_documento: "factura_b",
      es_compra_de_insumos: true,
      categoria_gasto_sugerida: null,
      proveedor_nombre: "Proveedor Viejo",
      proveedor_cuit: null,
      fecha: todayAR(),
      numero: "0001-00000001",
      moneda: "ARS",
      lineas: [{ descripcion: "HILO DENTAL", nombre_normalizado: "Hilo dental", cantidad: 2, unidad: "unidad", contenido_por_unidad: null, unidad_contenido: null, precio_unitario: 1500, importe: 3000, lote: null, vencimiento: null, confianza: "alta" }],
      subtotal: null,
      iva: null,
      otros_impuestos: null,
      descuentos: null,
      total: 3000,
      precios_incluyen_iva: true,
      legibilidad: "buena",
      observaciones: null,
    };
    await db.query("update documents set status = 'analizado', extraction = $2::jsonb, extraction_model = 'viejo' where id = $1", [id, JSON.stringify(v1)]);
    const review = (await buildReview(db, (await getDocument(db, id))!))!;
    expect(review.lines[0]).toMatchObject({ description: "HILO DENTAL", lineTotal: 3000 });
    expect(review.extraction).toMatchObject({ impuestos: [], campos_dudosos: [], letra: "B" });
    expect(review.checks).toContainEqual(expect.objectContaining({ level: "ok" }));
  });
});

describe("factura repetida sin lectura con IA (error 4 de la auditoría)", () => {
  const manualDoc = async (sha: string) => {
    const id = randomUUID();
    await createDocument(db, [{ fileName: "factura.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: sha, storage: "none", storageKey: null }], { source: "factura" }, id);
    return id;
  };

  it("pide confirmación al registrar otra vez el mismo archivo como compra o como gasto", async () => {
    const { ConfirmationRequiredError } = await import("@/lib/services/movements");
    const { createExpense } = await import("@/lib/services/expenses");
    const { findSameFiles } = await import("@/lib/services/documents");
    const sha = randomUUID();
    const first = await manualDoc(sha);
    const bought = await createPurchase(
      db,
      { supplierName: "Proveedor Repetido", purchaseDate: todayAR(), documentId: first, items: [{ productId: jeringa, quantity: 10, lineTotal: 1000 }] },
      { source: "factura" },
    );
    expect(bought.result.status).toBe("registrada");

    const second = await manualDoc(sha);
    expect((await findSameFiles(db, second)).map((s) => s.documentId)).toContain(first);

    const again = { supplierName: "Proveedor Repetido", purchaseDate: todayAR(), documentId: second, items: [{ productId: jeringa, quantity: 10, lineTotal: 1000 }] };
    const err = await createPurchase(db, again, { source: "factura" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfirmationRequiredError);
    expect(JSON.stringify((err as InstanceType<typeof ConfirmationRequiredError>).details)).toContain("Este mismo archivo ya se registró");
    const stock = (await getProduct(db, jeringa))?.currentStock;

    const third = await manualDoc(sha);
    const asExpense = { expenseDate: todayAR(), category: "Varios", description: "Misma factura", amount: 1000, documentId: third };
    await expect(createExpense(db, asExpense, { source: "factura" })).rejects.toBeInstanceOf(ConfirmationRequiredError);

    // Con confirmación explícita se puede registrar (por ejemplo, si de verdad es otra factura).
    const ok = await createPurchase(db, { ...again, acknowledgeWarnings: true }, { source: "factura" });
    expect(ok.result.status).toBe("registrada");
    expect((await getProduct(db, jeringa))?.currentStock).toBe((stock ?? 0) + 10);
  });

  it("un archivo distinto no genera el aviso", async () => {
    const doc = await manualDoc(randomUUID());
    const out = await createPurchase(
      db,
      { supplierName: "Proveedor Distinto", purchaseDate: todayAR(), documentId: doc, items: [{ productId: jeringa, quantity: 1, lineTotal: 100 }] },
      { source: "factura" },
    );
    expect(out.result.status).toBe("registrada");
  });
});

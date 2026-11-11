import { describe, expect, it } from "vitest";
import { coerceExtraction, type InvoiceExtraction, toIsoDate } from "@/lib/invoices/schema";
import { fieldLabel, formatPeriod, validateExtraction } from "@/lib/invoices/validate";

const TODAY = "2026-11-11";

/** Lectura completa de una factura de alquiler, como la devolvería el modelo con el esquema actual. */
export function rentalInvoice(over: Record<string, unknown> = {}): InvoiceExtraction {
  return coerceExtraction({
    tipo_documento: "factura",
    letra: null,
    descripcion_comprobante: "Factura de alquiler",
    numero: "0002-001273",
    fecha: "2026-11-03",
    fecha_vencimiento: "2026-11-10",
    periodo: "2026-11",
    proveedor_nombre: "Grupo Inmobiliario Rivadavia",
    proveedor_cuit: null,
    proveedor_domicilio: "Rivadavia 1378, Bahía Blanca",
    receptor_nombre: "María González",
    receptor_documento: "38765432",
    receptor_domicilio: "Alsina 567, Bahía Blanca",
    moneda: "ARS",
    es_compra_de_insumos: false,
    categoria_gasto_sugerida: "Alquiler",
    lineas: [
      { descripcion: "Alquiler mensual", tipo_linea: "servicio", cantidad: null, precio_unitario: null, importe: 350000, confianza: "alta" },
      { descripcion: "Expensas", tipo_linea: "servicio", cantidad: null, precio_unitario: null, importe: 70000, confianza: "alta" },
      { descripcion: "Servicios (luz)", tipo_linea: "servicio", cantidad: null, precio_unitario: null, importe: 22300, confianza: "alta" },
    ],
    subtotal: null,
    descuentos: null,
    iva: null,
    otros_impuestos: null,
    retenciones: null,
    impuestos: [],
    total: 442300,
    precios_incluyen_iva: true,
    legibilidad: "buena",
    varios_comprobantes: false,
    campos_dudosos: [],
    observaciones: null,
    ...over,
  });
}

const facturaA = (over: Record<string, unknown> = {}) =>
  coerceExtraction({
    tipo_documento: "factura_a",
    numero: "0003-00012345",
    fecha: "2026-11-05",
    proveedor_nombre: "Distribuidora Odonto SA",
    proveedor_cuit: "30712345671",
    es_compra_de_insumos: true,
    lineas: [
      { descripcion: "Guantes M x100", tipo_linea: "producto", cantidad: 2, precio_unitario: 10000, alicuota_iva: 21, importe: 20000, confianza: "alta" },
      { descripcion: "Eyectores x100", tipo_linea: "producto", cantidad: 1, precio_unitario: 5000, alicuota_iva: 21, importe: 5000, confianza: "alta" },
    ],
    subtotal: 25000,
    iva: 5250,
    otros_impuestos: 750,
    impuestos: [
      { tipo: "iva", descripcion: "IVA 21%", alicuota: 21, base_imponible: 25000, importe: 5250 },
      { tipo: "percepcion_iibb", descripcion: "Perc. IIBB", alicuota: 3, base_imponible: 25000, importe: 750 },
    ],
    total: 31000,
    precios_incluyen_iva: false,
    legibilidad: "buena",
    ...over,
  });

const levels = (ex: InvoiceExtraction) => validateExtraction(ex, TODAY).checks.map((c) => `${c.level}: ${c.message}`);

describe("normalización tolerante de la lectura", () => {
  it("convierte importes y fechas en formato argentino sin descartar el resto", () => {
    const ex = coerceExtraction({
      tipo_documento: "FACTURA_B",
      fecha: "03/11/2026",
      fecha_vencimiento: "10-11-26",
      periodo: "11/2026",
      total: "$ 442.300,00",
      subtotal: "abc",
      proveedor_cuit: "30-71234567-1",
      lineas: [{ descripcion: "Alquiler", importe: "350.000,00", cantidad: "1" }, { descripcion: "", importe: null }],
    });
    expect(ex).toMatchObject({ tipo_documento: "factura_b", letra: "B", fecha: "2026-11-03", fecha_vencimiento: "2026-11-10", periodo: "2026-11", total: 442300, subtotal: null, proveedor_cuit: "30712345671" });
    expect(ex.lineas).toHaveLength(1); // el renglón vacío no se inventa como línea
    expect(ex.lineas[0]).toMatchObject({ importe: 350000, cantidad: 1, tipo_linea: "otro", confianza: "media" });
    expect(ex.campos_dudosos).toContain("subtotal"); // no se pudo interpretar: queda marcado, no estimado
    expect(ex.impuestos).toEqual([]);
  });

  it("un tipo desconocido pasa a «otro» y queda marcado para revisar", () => {
    const ex = coerceExtraction({ tipo_documento: "boleta", legibilidad: "excelente" });
    expect(ex.tipo_documento).toBe("otro");
    expect(ex.legibilidad).toBe("regular");
    expect(ex.campos_dudosos).toEqual(expect.arrayContaining(["tipo_documento", "legibilidad"]));
  });

  it("las lecturas guardadas con la versión anterior siguen funcionando", () => {
    const v1 = {
      tipo_documento: "factura_a",
      es_compra_de_insumos: true,
      categoria_gasto_sugerida: null,
      proveedor_nombre: "Dental Sur",
      proveedor_cuit: "30712345671",
      fecha: "2026-11-05",
      numero: "0003-1",
      moneda: "ARS",
      lineas: [{ descripcion: "X", nombre_normalizado: null, cantidad: 1, unidad: null, contenido_por_unidad: null, unidad_contenido: null, precio_unitario: 10, importe: 10, lote: null, vencimiento: null, confianza: "alta" }],
      subtotal: 10,
      iva: 2.1,
      otros_impuestos: null,
      descuentos: null,
      total: 12.1,
      precios_incluyen_iva: false,
      legibilidad: "buena",
      observaciones: null,
    };
    const ex = coerceExtraction(v1);
    expect(ex).toMatchObject({ letra: "A", receptor_nombre: null, impuestos: [], varios_comprobantes: false, campos_dudosos: [] });
    expect(ex.lineas[0]).toMatchObject({ tipo_linea: "otro", codigo: null, descuento: null });
    expect(validateExtraction(ex, TODAY).status).toBe("ok");
  });

  it("toIsoDate rechaza fechas imposibles", () => {
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("2026-13-01")).toBeNull();
    expect(toIsoDate("1/2/2026")).toBe("2026-02-01");
  });
});

describe("controles de consistencia", () => {
  it("factura de alquiler sin IVA: los conceptos suman el total", () => {
    const v = validateExtraction(rentalInvoice(), TODAY);
    expect(v.checks).toContainEqual(expect.objectContaining({ level: "ok", message: expect.stringContaining("coincide con el total") }));
    expect(v.checks.filter((c) => c.level === "error")).toEqual([]);
    // Lo único a revisar es que no figura el CUIT del emisor (no se inventa).
    expect(v.checks.filter((c) => c.level === "aviso").map((c) => c.fields)).toEqual([["proveedor_cuit"]]);
  });

  it("factura A completa: subtotal + IVA + percepciones = total y detalle de impuestos coherente", () => {
    const v = validateExtraction(facturaA(), TODAY);
    expect(v.status).toBe("ok");
    expect(levels(facturaA()).every((l) => l.startsWith("ok"))).toBe(true);
  });

  it("detecta totales que no cierran y marca los campos", () => {
    const v = validateExtraction(facturaA({ total: 33000 }), TODAY);
    expect(v.status).toBe("revisar");
    expect(v.checks).toContainEqual(expect.objectContaining({ level: "error", message: expect.stringContaining("no cierran") }));
    expect(v.doubtful).toEqual(expect.arrayContaining(["total", "subtotal"]));
  });

  it("detecta una línea con cantidad × precio distinto del importe", () => {
    const ex = facturaA();
    ex.lineas[0].importe = 2000; // un cero perdido al leer
    const v = validateExtraction(ex, TODAY);
    expect(v.checks).toContainEqual(expect.objectContaining({ level: "aviso", message: expect.stringContaining("Línea 1") }));
    expect(v.doubtful).toContain("lineas[0].importe");
  });

  it("detecta una línea faltante o sobrante (la suma no da el subtotal ni el total)", () => {
    const ex = rentalInvoice();
    ex.lineas.pop();
    const v = validateExtraction(ex, TODAY);
    expect(v.checks).toContainEqual(expect.objectContaining({ level: "aviso", message: expect.stringContaining("no coincide") }));
  });

  it("acepta descuentos por línea en pesos o en porcentaje, e IVA incluido en el importe", () => {
    const ex = facturaA({
      lineas: [
        { descripcion: "A", cantidad: 2, precio_unitario: 1000, descuento: 200, importe: 1800 },
        { descripcion: "B", cantidad: 1, precio_unitario: 1000, descuento: 10, importe: 900 },
        { descripcion: "C", cantidad: 1, precio_unitario: 1000, alicuota_iva: 21, importe: 1210 },
      ],
      subtotal: null,
      iva: null,
      otros_impuestos: null,
      impuestos: [],
      total: 3910,
    });
    expect(validateExtraction(ex, TODAY).checks.filter((c) => c.message.startsWith("Línea"))).toEqual([]);
  });

  it("el IVA contenido (informativo) no rompe el control del total", () => {
    const ex = coerceExtraction({ ...rentalInvoice(), tipo_documento: "factura_b", subtotal: 442300, impuestos: [{ tipo: "otro", descripcion: "IVA contenido", importe: 76762 }] });
    expect(validateExtraction(ex, TODAY).checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("fechas: posterior a hoy, vencimiento anterior a la emisión y fecha inválida", () => {
    expect(levels(rentalInvoice({ fecha: "2026-11-28", fecha_vencimiento: "2026-12-05" }))).toContainEqual(expect.stringContaining("posterior a hoy"));
    expect(levels(rentalInvoice({ fecha_vencimiento: "2026-10-01" }))).toContainEqual(expect.stringContaining("anterior a la emisión"));
    expect(levels(rentalInvoice({ fecha: "45/13/2026" }))).toContainEqual(expect.stringContaining("no es una fecha válida"));
  });

  it("CUIT con dígito verificador incorrecto, documento del cliente raro, factura C con IVA", () => {
    expect(levels(facturaA({ proveedor_cuit: "30712345670" }))).toContainEqual(expect.stringMatching(/^error: El CUIT del emisor/));
    expect(levels(rentalInvoice({ receptor_documento: "123" }))).toContainEqual(expect.stringContaining("no parece un CUIT o DNI"));
    expect(levels(facturaA({ tipo_documento: "factura_c" }))).toContainEqual(expect.stringContaining("Las facturas C no discriminan IVA"));
  });

  it("faltan datos esenciales: total, conceptos, emisor", () => {
    const v = validateExtraction(coerceExtraction({ tipo_documento: "otro", legibilidad: "mala" }), TODAY);
    const messages = v.checks.map((c) => c.message).join(" | ");
    expect(messages).toContain("No se encontró el total");
    expect(messages).toContain("No se detectaron conceptos");
    expect(messages).toContain("No se identificó quién emite");
    expect(messages).toContain("con mucha dificultad");
  });

  it("varias facturas distintas en una misma subida", () => {
    expect(levels(rentalInvoice({ varios_comprobantes: true }))[0]).toMatch(/^error: .*comprobantes distintos/);
  });

  it("los campos marcados por la lectura se conservan para la revisión", () => {
    const v = validateExtraction(rentalInvoice({ campos_dudosos: ["lineas[2].importe"] }), TODAY);
    expect(v.doubtful).toContain("lineas[2].importe");
    expect(fieldLabel("lineas[2].importe")).toBe("línea 3: importe");
    expect(fieldLabel("proveedor_cuit")).toBe("CUIT del proveedor");
    expect(formatPeriod("2026-11")).toBe("11/2026");
  });
});

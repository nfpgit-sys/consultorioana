import { z } from "zod/v4";
import { parseDecimalAR } from "@/lib/domain/numbers";

/**
 * Datos que el modelo extrae de un comprobante (facturas A/B/C/M/E, tickets, recibos, remitos,
 * notas de crédito/débito, liquidaciones, facturas de servicios o alquileres, etc.).
 *
 * Principio: todo dato ilegible o ausente va en null y se anota en `campos_dudosos`; nunca se
 * completa con suposiciones. El esquema no depende de ninguna plantilla de factura.
 */
const text = (description: string) => z.string().nullable().describe(description);
const amount = (description: string) => z.number().nullable().describe(description);

export const INVOICE_DOC_KINDS = [
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
  "factura_e",
  "factura",
  "ticket",
  "recibo",
  "remito",
  "nota_credito",
  "nota_debito",
  "liquidacion",
  "presupuesto",
  "otro",
] as const;

export const InvoiceLineSchema = z.object({
  descripcion: z.string().describe("Texto completo de la línea tal como figura (si ocupa varios renglones, unilos)."),
  nombre_normalizado: text("Nombre claro del producto o concepto, expandiendo abreviaturas (ej.: 'JER DESC 5ML C/AG' -> 'Jeringa descartable 5 ml con aguja')."),
  codigo: text("Código del artículo si figura."),
  tipo_linea: z.enum(["producto", "servicio", "otro"]).describe("producto = algo físico que se guarda; servicio = alquiler, expensas, luz, mano de obra, honorarios, etc."),
  cantidad: amount("Cantidad facturada en la unidad de venta de la línea (null si no figura)."),
  unidad: text("Unidad de venta tal como figura (unidad, caja, tubo, kg, mes...)."),
  contenido_por_unidad: amount("Si el texto indica cuánto trae cada unidad de venta (ej.: 'caja x100', 'x 50 u', 'pomo 4 g'), ese número."),
  unidad_contenido: text("Unidad de ese contenido (unidades, g, ml...)."),
  precio_unitario: amount("Precio por unidad de venta."),
  descuento: amount("Descuento aplicado en la línea, en pesos."),
  alicuota_iva: amount("Alícuota de IVA de la línea en porcentaje (21, 10.5, 27, 0), si figura."),
  importe: amount("Importe total de la línea."),
  lote: text("Lote, si figura."),
  vencimiento: text("Vencimiento del producto AAAA-MM-DD, si figura."),
  confianza: z.enum(["alta", "media", "baja"]).describe("Qué tan legible y segura es la lectura de esta línea."),
});

export const InvoiceTaxSchema = z.object({
  tipo: z.enum(["iva", "percepcion_iva", "percepcion_iibb", "retencion", "impuesto_interno", "otro"]),
  descripcion: text("Texto del impuesto tal como figura (ej.: 'IVA 21%', 'Perc. IIBB CABA')."),
  alicuota: amount("Alícuota en porcentaje, si figura."),
  base_imponible: amount("Base imponible, si figura."),
  importe: amount("Importe del impuesto."),
});

export const InvoiceExtractionSchema = z.object({
  tipo_documento: z.enum(INVOICE_DOC_KINDS).describe("«factura» si dice factura pero no se ve la letra."),
  letra: text("Letra del comprobante (A, B, C, M, E) si figura."),
  descripcion_comprobante: text("Título del comprobante tal como figura (ej.: 'Factura de alquiler', 'Recibo X')."),
  numero: text("Punto de venta y número (ej.: 0001-00001234)."),
  fecha: text("Fecha de emisión AAAA-MM-DD."),
  fecha_vencimiento: text("Fecha de vencimiento del pago AAAA-MM-DD, si figura."),
  periodo: text("Período facturado AAAA-MM (o AAAA-MM-DD/AAAA-MM-DD si es un rango), si figura."),
  cae: text("CAE o CAI, si figura."),
  proveedor_nombre: text("Razón social o nombre del EMISOR (quien emite y cobra)."),
  proveedor_cuit: text("CUIT del emisor, solo dígitos."),
  proveedor_domicilio: text("Domicilio del emisor."),
  proveedor_condicion_iva: text("Condición frente al IVA del emisor (Responsable inscripto, Monotributo, Exento...)."),
  receptor_nombre: text("Nombre del cliente/RECEPTOR (a quien se le factura)."),
  receptor_documento: text("CUIT, CUIL o DNI del receptor, solo dígitos."),
  receptor_domicilio: text("Domicilio del receptor o del inmueble/servicio facturado."),
  condicion_venta: text("Condición de venta o forma de pago (contado, cuenta corriente, tarjeta...)."),
  moneda: text("ARS, USD u otra si se indica."),
  es_compra_de_insumos: z
    .boolean()
    .describe("true si incluye materiales o insumos que se guardan en el inventario; false si es un servicio o gasto general (luz, alquiler, expensas, laboratorio, mantenimiento, honorarios, etc.)."),
  categoria_gasto_sugerida: text("Si es gasto general, categoría breve: Alquiler, Expensas, Luz, Gas, Agua, Internet, Laboratorio dental, Mantenimiento de equipos, etc."),
  lineas: z.array(InvoiceLineSchema).describe("Una entrada por cada producto, servicio o concepto facturado. No incluir subtotales, impuestos ni el total."),
  subtotal: amount("Importe neto / subtotal antes de impuestos, si figura."),
  descuentos: amount("Descuentos o bonificaciones generales, si figuran."),
  iva: amount("Suma del IVA discriminado, si figura."),
  otros_impuestos: amount("Suma de percepciones e impuestos que se agregan al total (sin el IVA)."),
  retenciones: amount("Retenciones informadas (no suelen cambiar el total)."),
  impuestos: z.array(InvoiceTaxSchema).describe("Detalle de cada impuesto, percepción o retención que figure."),
  total: amount("Total final a pagar del comprobante."),
  precios_incluyen_iva: z.boolean().nullable().describe("true si los importes de las líneas ya incluyen IVA (típico de facturas B/C, tickets y facturas de servicios)."),
  legibilidad: z.enum(["buena", "regular", "mala"]),
  varios_comprobantes: z.boolean().describe("true si las imágenes o páginas son de comprobantes DISTINTOS (no páginas del mismo). En ese caso extraé solo el primero."),
  campos_dudosos: z.array(z.string()).describe("Campos que no se pudieron leer con certeza (ej.: 'total', 'fecha', 'lineas[2].importe')."),
  observaciones: text("Dudas o problemas de lectura, en español."),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type InvoiceTax = z.infer<typeof InvoiceTaxSchema>;

/* -------------------------- Normalización tolerante -------------------------- */

type Raw = Record<string, unknown>;

/**
 * El título del comprobante decide el tipo: si dice «Factura» (y no es un tique, una nota ni un
 * «factura/recibo» combinado), es una factura aunque le falten datos fiscales y el modelo la haya
 * clasificado como recibo u otro. Usa la letra leída si la hay.
 */
export function kindFromTitle(kind: (typeof INVOICE_DOC_KINDS)[number], title: string | null, letter: string | null): (typeof INVOICE_DOC_KINDS)[number] {
  if (!title || kind.startsWith("factura")) return kind;
  const t = title.toLowerCase();
  if (!/\bfactura\b/.test(t) || /\b(recibo|nota|tique|ticket|remito|presupuesto)\b/.test(t)) return kind;
  if (!["recibo", "otro", "liquidacion"].includes(kind)) return kind;
  const fromLetter = letter && /^[ABCME]$/.test(letter) ? (`factura_${letter.toLowerCase()}` as (typeof INVOICE_DOC_KINDS)[number]) : null;
  return fromLetter ?? "factura";
}

/** Acepta AAAA-MM-DD y también DD/MM/AAAA o DD-MM-AA (formato argentino). Devuelve null si no es una fecha real. */
export function toIsoDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Convierte la respuesta del modelo (o una extracción guardada con el formato anterior) al
 * esquema actual sin perder datos: los números escritos como texto («$ 350.000,00») se
 * interpretan, los valores desconocidos se reemplazan por uno neutro y todo lo que se tuvo
 * que corregir o no se pudo interpretar se agrega a `campos_dudosos`.
 */
export function coerceExtraction(input: unknown): InvoiceExtraction {
  const raw: Raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Raw) : {};
  const doubtful = new Set<string>(Array.isArray(raw.campos_dudosos) ? raw.campos_dudosos.filter((x): x is string => typeof x === "string") : []);

  const str = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };
  const num = (v: unknown, path: string): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim()) {
      const parsed = parseDecimalAR(v.replace(/[^\d.,-]/g, ""));
      if (parsed === null) doubtful.add(path);
      return parsed;
    }
    return null;
  };
  const date = (v: unknown, path: string): string | null => {
    const s = str(v);
    if (!s) return null;
    const iso = toIsoDate(s);
    if (!iso) doubtful.add(path);
    return iso ?? s;
  };
  const period = (v: unknown): string | null => {
    const s = str(v);
    if (!s) return null;
    const m = /^(\d{1,2})[/-](\d{4})$/.exec(s); // 11/2026
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
    return s;
  };
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T, path: string): T => {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    if ((allowed as readonly string[]).includes(s)) return s as T;
    if (s) doubtful.add(path);
    return fallback;
  };

  const linesRaw = Array.isArray(raw.lineas) ? (raw.lineas as unknown[]) : [];
  const lineas: InvoiceLine[] = [];
  linesRaw.forEach((l, i) => {
    const r: Raw = l && typeof l === "object" ? (l as Raw) : {};
    const p = `lineas[${i}]`;
    const descripcion = str(r.descripcion) ?? str(r.nombre_normalizado);
    const importe = num(r.importe, `${p}.importe`);
    if (!descripcion && importe === null) return; // renglón vacío
    lineas.push({
      descripcion: descripcion ?? "(sin descripción legible)",
      nombre_normalizado: str(r.nombre_normalizado),
      codigo: str(r.codigo),
      tipo_linea: oneOf(r.tipo_linea, ["producto", "servicio", "otro"] as const, "otro", `${p}.tipo_linea`),
      cantidad: num(r.cantidad, `${p}.cantidad`),
      unidad: str(r.unidad),
      contenido_por_unidad: num(r.contenido_por_unidad, `${p}.contenido_por_unidad`),
      unidad_contenido: str(r.unidad_contenido),
      precio_unitario: num(r.precio_unitario, `${p}.precio_unitario`),
      descuento: num(r.descuento, `${p}.descuento`),
      alicuota_iva: num(r.alicuota_iva, `${p}.alicuota_iva`),
      importe,
      lote: str(r.lote),
      vencimiento: date(r.vencimiento, `${p}.vencimiento`),
      confianza: oneOf(r.confianza, ["alta", "media", "baja"] as const, "media", `${p}.confianza`),
    });
    if (!descripcion) doubtful.add(`${p}.descripcion`);
  });

  const taxesRaw = Array.isArray(raw.impuestos) ? (raw.impuestos as unknown[]) : [];
  const impuestos: InvoiceTax[] = taxesRaw
    .map((t, i) => {
      const r: Raw = t && typeof t === "object" ? (t as Raw) : {};
      return {
        tipo: oneOf(r.tipo, ["iva", "percepcion_iva", "percepcion_iibb", "retencion", "impuesto_interno", "otro"] as const, "otro", `impuestos[${i}].tipo`),
        descripcion: str(r.descripcion),
        alicuota: num(r.alicuota, `impuestos[${i}].alicuota`),
        base_imponible: num(r.base_imponible, `impuestos[${i}].base_imponible`),
        importe: num(r.importe, `impuestos[${i}].importe`),
      };
    })
    .filter((t) => t.importe !== null || t.descripcion);

  const title = str(raw.descripcion_comprobante);
  const letter = str(raw.letra)?.toUpperCase().slice(0, 1) ?? null;
  const tipo = kindFromTitle(oneOf(raw.tipo_documento, INVOICE_DOC_KINDS, "otro", "tipo_documento"), title, letter);
  const result: InvoiceExtraction = {
    tipo_documento: tipo,
    letra: letter ?? (/^factura_([abcme])$/.exec(tipo)?.[1].toUpperCase() ?? null),
    descripcion_comprobante: title,
    numero: str(raw.numero),
    fecha: date(raw.fecha, "fecha"),
    fecha_vencimiento: date(raw.fecha_vencimiento, "fecha_vencimiento"),
    periodo: period(raw.periodo),
    cae: str(raw.cae),
    proveedor_nombre: str(raw.proveedor_nombre),
    proveedor_cuit: str(raw.proveedor_cuit)?.replace(/\D/g, "") || null,
    proveedor_domicilio: str(raw.proveedor_domicilio),
    proveedor_condicion_iva: str(raw.proveedor_condicion_iva),
    receptor_nombre: str(raw.receptor_nombre),
    receptor_documento: str(raw.receptor_documento)?.replace(/\D/g, "") || null,
    receptor_domicilio: str(raw.receptor_domicilio),
    condicion_venta: str(raw.condicion_venta),
    moneda: str(raw.moneda),
    es_compra_de_insumos: bool(raw.es_compra_de_insumos) ?? lineas.some((l) => l.tipo_linea === "producto"),
    categoria_gasto_sugerida: str(raw.categoria_gasto_sugerida),
    lineas,
    subtotal: num(raw.subtotal, "subtotal"),
    descuentos: num(raw.descuentos, "descuentos"),
    iva: num(raw.iva, "iva"),
    otros_impuestos: num(raw.otros_impuestos, "otros_impuestos"),
    retenciones: num(raw.retenciones, "retenciones"),
    impuestos,
    total: num(raw.total, "total"),
    precios_incluyen_iva: bool(raw.precios_incluyen_iva),
    legibilidad: oneOf(raw.legibilidad, ["buena", "regular", "mala"] as const, "regular", "legibilidad"),
    varios_comprobantes: bool(raw.varios_comprobantes) ?? false,
    campos_dudosos: [],
    observaciones: str(raw.observaciones),
  };
  result.campos_dudosos = [...doubtful];
  return result;
}

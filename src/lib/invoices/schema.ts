import { z } from "zod/v4";

/**
 * Datos que el modelo extrae de una factura o recibo. Todo campo ilegible o ausente va en null:
 * nunca se completa con suposiciones.
 */
export const InvoiceLineSchema = z.object({
  descripcion: z.string().describe("Texto de la línea tal como figura en el comprobante."),
  nombre_normalizado: z
    .string()
    .nullable()
    .describe("Nombre claro del producto, expandiendo abreviaturas (ej.: 'JER DESC 5ML C/AG' -> 'Jeringa descartable 5 ml con aguja'). Sin marca si no aporta."),
  cantidad: z.number().nullable().describe("Cantidad facturada en la unidad de venta de la línea."),
  unidad: z.string().nullable().describe("Unidad de venta tal como figura (unidad, caja, tubo, frasco, kg...)."),
  contenido_por_unidad: z
    .number()
    .nullable()
    .describe("Si el texto indica el contenido de cada unidad de venta (ej.: 'caja x100', 'x 50 u', 'pomo 4 g'), ese número; si no, null."),
  unidad_contenido: z.string().nullable().describe("Unidad de ese contenido (unidades, g, ml...)."),
  precio_unitario: z.number().nullable(),
  importe: z.number().nullable().describe("Importe total de la línea."),
  lote: z.string().nullable(),
  vencimiento: z.string().nullable().describe("AAAA-MM-DD si figura."),
  confianza: z.enum(["alta", "media", "baja"]).describe("Qué tan legible y segura es la lectura de esta línea."),
});

export const InvoiceExtractionSchema = z.object({
  tipo_documento: z.enum(["factura_a", "factura_b", "factura_c", "factura_m", "ticket", "recibo", "remito", "nota_credito", "otro"]),
  es_compra_de_insumos: z
    .boolean()
    .describe("true si incluye materiales o insumos que se guardan en el inventario; false si es un servicio o gasto general (luz, alquiler, laboratorio, mantenimiento, honorarios, etc.)."),
  categoria_gasto_sugerida: z.string().nullable().describe("Si es gasto general, categoría breve: Luz, Gas, Agua, Alquiler, Laboratorio dental, Mantenimiento de equipos, etc."),
  proveedor_nombre: z.string().nullable().describe("Razón social o nombre del emisor del comprobante."),
  proveedor_cuit: z.string().nullable().describe("CUIT del emisor, solo dígitos."),
  fecha: z.string().nullable().describe("Fecha de emisión AAAA-MM-DD."),
  numero: z.string().nullable().describe("Punto de venta y número (ej.: 0001-00001234)."),
  moneda: z.string().nullable().describe("ARS, USD u otra si se indica."),
  lineas: z.array(InvoiceLineSchema),
  subtotal: z.number().nullable().describe("Importe neto / subtotal antes de impuestos."),
  iva: z.number().nullable().describe("IVA discriminado (suma de alícuotas), si figura."),
  otros_impuestos: z.number().nullable().describe("Percepciones u otros impuestos (IIBB, etc.)."),
  descuentos: z.number().nullable(),
  total: z.number().nullable().describe("Total final del comprobante."),
  precios_incluyen_iva: z.boolean().nullable().describe("true si los importes de las líneas ya incluyen IVA (típico de facturas B/C y tickets)."),
  legibilidad: z.enum(["buena", "regular", "mala"]),
  observaciones: z.string().nullable().describe("Dudas o problemas de lectura, en español."),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

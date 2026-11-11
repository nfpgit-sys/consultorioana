import { addDays, formatARS, formatDate, isValidIsoDate } from "@/lib/domain/format";
import type { InvoiceExtraction } from "./schema";

/**
 * Controles automáticos sobre los datos leídos de un comprobante. No dependen del diseño de la
 * factura: verifican que los números cierren entre sí (líneas, subtotal, impuestos y total),
 * que las fechas y el CUIT sean coherentes y que no falten datos esenciales.
 *
 * Nada se corrige solo: cada control que no cierra se informa y marca los campos para revisar.
 */
export type CheckLevel = "ok" | "aviso" | "error";

export interface InvoiceCheck {
  level: CheckLevel;
  message: string;
  /** Campos involucrados (mismas rutas que `campos_dudosos`: "total", "lineas[2].importe"...). */
  fields: string[];
}

export interface InvoiceValidation {
  checks: InvoiceCheck[];
  /** Campos a revisar: los que marcó la lectura más los que no pasaron un control. */
  doubtful: string[];
  status: "ok" | "revisar";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Igualdad con tolerancia de redondeo (centavos por línea, IVA calculado por renglón, etc.). */
const near = (a: number, b: number, rel = 0.0005) => Math.abs(a - b) <= Math.max(1.5, Math.abs(b) * rel);

/** Verifica el dígito de un CUIT/CUIL (11 dígitos). */
export function cuitCheckDigitOk(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) check = 9;
  return check === Number(digits[10]);
}

/** Importe de una línea: el leído o, si falta, cantidad × precio. */
export function lineAmount(l: InvoiceExtraction["lineas"][number]): number | null {
  if (l.importe !== null) return l.importe;
  if (l.cantidad !== null && l.precio_unitario !== null) return round2(l.cantidad * l.precio_unitario - (l.descuento ?? 0));
  return null;
}

export function validateExtraction(ex: InvoiceExtraction, today: string): InvoiceValidation {
  const checks: InvoiceCheck[] = [];
  const add = (level: CheckLevel, message: string, fields: string[] = []) => checks.push({ level, message, fields });
  const money = (n: number) => formatARS(n);

  if (ex.varios_comprobantes) {
    add("error", "Las imágenes parecen ser de comprobantes distintos. Se leyó solo el primero: subí cada comprobante por separado.", []);
  }

  /* ---------------------------- Identificación ---------------------------- */
  if (!ex.proveedor_nombre) add("aviso", "No se identificó quién emite el comprobante (proveedor).", ["proveedor_nombre"]);
  if (ex.proveedor_cuit) {
    if (!cuitCheckDigitOk(ex.proveedor_cuit)) add("error", `El CUIT del emisor (${ex.proveedor_cuit}) no es válido: puede estar mal leído.`, ["proveedor_cuit"]);
  } else if (ex.tipo_documento.startsWith("factura") || ex.tipo_documento.startsWith("nota_")) {
    add("aviso", "El comprobante no muestra el CUIT del emisor.", ["proveedor_cuit"]);
  }
  if (ex.receptor_documento) {
    const d = ex.receptor_documento;
    const ok = d.length === 11 ? cuitCheckDigitOk(d) : d.length >= 7 && d.length <= 8;
    if (!ok) add("aviso", `El documento del cliente (${d}) no parece un CUIT o DNI válido.`, ["receptor_documento"]);
  }
  if (!ex.numero && ex.tipo_documento !== "ticket" && ex.tipo_documento !== "otro") add("aviso", "No se encontró el número del comprobante.", ["numero"]);
  if (ex.letra && /^factura_[abcme]$/.test(ex.tipo_documento) && ex.tipo_documento.slice(-1).toUpperCase() !== ex.letra) {
    add("aviso", `La letra leída (${ex.letra}) no coincide con el tipo de factura.`, ["letra", "tipo_documento"]);
  }

  /* -------------------------------- Fechas -------------------------------- */
  if (!ex.fecha) add("aviso", "No se encontró la fecha de emisión.", ["fecha"]);
  else if (!isValidIsoDate(ex.fecha)) add("error", `La fecha de emisión «${ex.fecha}» no es una fecha válida.`, ["fecha"]);
  else if (ex.fecha > today) add("aviso", `La fecha de emisión (${formatDate(ex.fecha)}) es posterior a hoy: revisá que esté bien leída.`, ["fecha"]);
  else if (ex.fecha < addDays(today, -400)) add("aviso", `La fecha de emisión (${formatDate(ex.fecha)}) tiene más de un año: revisá que esté bien leída.`, ["fecha"]);
  if (ex.fecha_vencimiento) {
    if (!isValidIsoDate(ex.fecha_vencimiento)) add("aviso", `El vencimiento «${ex.fecha_vencimiento}» no es una fecha válida.`, ["fecha_vencimiento"]);
    else if (ex.fecha && isValidIsoDate(ex.fecha) && ex.fecha_vencimiento < ex.fecha) {
      add("aviso", `El vencimiento (${formatDate(ex.fecha_vencimiento)}) es anterior a la emisión (${formatDate(ex.fecha)}).`, ["fecha_vencimiento", "fecha"]);
    }
  }

  /* ------------------------------- Líneas -------------------------------- */
  if (ex.lineas.length === 0) add("aviso", "No se detectaron conceptos ni productos en el comprobante.", ["lineas"]);
  ex.lineas.forEach((l, i) => {
    if (l.cantidad === null || l.precio_unitario === null || l.importe === null) return;
    const base = l.cantidad * l.precio_unitario;
    const desc = l.descuento ?? 0;
    const iva = l.alicuota_iva ?? 0;
    // El importe puede venir con o sin descuento, con o sin IVA; el descuento puede ser un porcentaje.
    const candidates = [base - desc, base, base * (1 - desc / 100), (base - desc) * (1 + iva / 100), base * (1 + iva / 100)];
    if (!candidates.some((c) => Math.abs(c - l.importe!) <= Math.max(1, Math.abs(l.importe!) * 0.002))) {
      add(
        "aviso",
        `Línea ${i + 1}: ${l.cantidad} × ${money(l.precio_unitario)}${desc ? ` − descuento ${money(desc)}` : ""} = ${money(round2(base - desc))}, pero el importe leído es ${money(l.importe)}.`,
        [`lineas[${i}].cantidad`, `lineas[${i}].precio_unitario`, `lineas[${i}].importe`],
      );
    }
  });
  const dubiousLines = ex.lineas.map((l, i) => (l.confianza === "baja" ? i : -1)).filter((i) => i >= 0);
  if (dubiousLines.length) {
    add("aviso", `${dubiousLines.length === 1 ? "La línea" : "Las líneas"} ${dubiousLines.map((i) => i + 1).join(", ")} se ${dubiousLines.length === 1 ? "leyó" : "leyeron"} con dudas.`, dubiousLines.map((i) => `lineas[${i}]`));
  }

  /* ------------------------------- Importes ------------------------------- */
  const { subtotal, total } = ex;
  const iva = ex.iva ?? 0;
  const otros = ex.otros_impuestos ?? 0;
  const desc = ex.descuentos ?? 0;
  const amounts = ex.lineas.map(lineAmount);
  const sum = amounts.length && amounts.every((a) => a !== null) ? round2(amounts.reduce<number>((a, b) => a + (b ?? 0), 0)) : null;

  if (total === null) add("error", "No se encontró el total del comprobante.", ["total"]);
  else if (total <= 0 && ex.tipo_documento !== "nota_credito") add("aviso", `El total leído (${money(total)}) no es un importe positivo.`, ["total"]);

  if (sum !== null && (subtotal !== null || total !== null)) {
    const matches: [boolean, string][] = [
      [subtotal !== null && near(sum, subtotal), "el subtotal"],
      [subtotal !== null && near(sum, subtotal + iva), "el subtotal con IVA"],
      [total !== null && near(sum, total), "el total"],
      [total !== null && near(sum - desc + iva + otros, total), "el total (con descuentos e impuestos)"],
      [total !== null && near(sum - desc + otros, total), "el total (con descuentos y percepciones)"],
      [total !== null && near(sum - desc, total), "el total (con descuentos)"],
    ];
    const hit = matches.find(([ok]) => ok);
    if (hit) add("ok", `La suma de los conceptos (${money(sum)}) coincide con ${hit[1]}.`);
    else {
      const ref = [subtotal !== null ? `el subtotal (${money(subtotal)})` : null, total !== null ? `el total (${money(total)})` : null].filter(Boolean).join(" ni con ");
      add("aviso", `La suma de los conceptos (${money(sum)}) no coincide con ${ref}. Puede faltar una línea o haber un importe mal leído.`, ["lineas", ...(subtotal !== null ? ["subtotal"] : []), "total"]);
    }
  } else if (ex.lineas.length && sum === null) {
    add("aviso", "Hay líneas sin importe: no se pudo comprobar que sumen el total.", ex.lineas.map((l, i) => (lineAmount(l) === null ? `lineas[${i}].importe` : "")).filter(Boolean));
  }

  if (subtotal !== null && total !== null) {
    const expected = round2(subtotal - desc + iva + otros);
    // Variantes válidas: IVA ya incluido en el subtotal, o IVA solo informativo («IVA contenido», Ley 27.743).
    const ok = near(expected, total) || near(subtotal - desc + otros, total) || near(subtotal - desc, total) || near(subtotal, total);
    if (ok) add("ok", "Subtotal, descuentos, impuestos y total son coherentes.");
    else {
      add(
        "error",
        `Los importes no cierran: subtotal ${money(subtotal)}${desc ? ` − descuentos ${money(desc)}` : ""}${iva ? ` + IVA ${money(iva)}` : ""}${otros ? ` + otros impuestos ${money(otros)}` : ""} = ${money(expected)}, pero el total leído es ${money(total)}.`,
        ["subtotal", "descuentos", "iva", "otros_impuestos", "total"].filter((f) => f === "subtotal" || f === "total" || ex[f as "iva"] !== null),
      );
    }
  }

  /* ------------------------------ Impuestos ------------------------------- */
  const ivaItems = ex.impuestos.filter((t) => t.tipo === "iva" && t.importe !== null);
  if (ivaItems.length && ex.iva !== null) {
    const s = round2(ivaItems.reduce((a, t) => a + (t.importe ?? 0), 0));
    if (!near(s, ex.iva)) add("aviso", `El detalle de IVA suma ${money(s)}, pero el IVA total leído es ${money(ex.iva)}.`, ["iva", "impuestos"]);
  }
  const otherItems = ex.impuestos.filter((t) => ["percepcion_iva", "percepcion_iibb", "impuesto_interno"].includes(t.tipo) && t.importe !== null);
  if (otherItems.length && ex.otros_impuestos !== null) {
    const s = round2(otherItems.reduce((a, t) => a + (t.importe ?? 0), 0));
    if (!near(s, ex.otros_impuestos)) add("aviso", `El detalle de percepciones suma ${money(s)}, pero «otros impuestos» dice ${money(ex.otros_impuestos)}.`, ["otros_impuestos", "impuestos"]);
  }
  ex.impuestos.forEach((t, i) => {
    if (t.base_imponible === null || t.alicuota === null || t.importe === null || t.alicuota <= 0) return;
    const expected = round2((t.base_imponible * t.alicuota) / 100);
    if (Math.abs(expected - t.importe) > Math.max(1, t.importe * 0.01)) {
      add("aviso", `${t.descripcion ?? "Un impuesto"}: ${t.alicuota}% de ${money(t.base_imponible)} es ${money(expected)}, pero figura ${money(t.importe)}.`, [`impuestos[${i}].importe`]);
    }
  });
  const hasIva = (ex.iva ?? 0) > 0 || ivaItems.some((t) => (t.importe ?? 0) > 0);
  if (ex.tipo_documento === "factura_a" && !hasIva && ex.lineas.length) add("aviso", "Es una factura A pero no se leyó IVA discriminado.", ["iva"]);
  if (ex.tipo_documento === "factura_c" && (ex.iva ?? 0) > 0) add("aviso", "Las facturas C no discriminan IVA: revisá el IVA leído.", ["iva"]);

  /* ------------------------------- Lectura -------------------------------- */
  if (ex.legibilidad === "mala") add("aviso", "El comprobante se leyó con mucha dificultad (imagen borrosa, cortada o con poca luz). Revisá todos los datos.", []);

  const doubtful = [...new Set([...ex.campos_dudosos, ...checks.filter((c) => c.level !== "ok").flatMap((c) => c.fields)])];
  return { checks, doubtful, status: checks.some((c) => c.level !== "ok") ? "revisar" : "ok" };
}

const FIELD_LABELS: Record<string, string> = {
  tipo_documento: "tipo de comprobante",
  letra: "letra",
  numero: "número",
  fecha: "fecha de emisión",
  fecha_vencimiento: "vencimiento",
  periodo: "período",
  cae: "CAE",
  proveedor_nombre: "proveedor",
  proveedor_cuit: "CUIT del proveedor",
  proveedor_domicilio: "domicilio del proveedor",
  receptor_nombre: "cliente",
  receptor_documento: "documento del cliente",
  receptor_domicilio: "domicilio del cliente",
  subtotal: "subtotal",
  descuentos: "descuentos",
  iva: "IVA",
  otros_impuestos: "otros impuestos",
  retenciones: "retenciones",
  impuestos: "detalle de impuestos",
  total: "total",
  lineas: "conceptos",
  moneda: "moneda",
};
const LINE_FIELD_LABELS: Record<string, string> = {
  descripcion: "descripción",
  cantidad: "cantidad",
  precio_unitario: "precio unitario",
  importe: "importe",
  descuento: "descuento",
  vencimiento: "vencimiento",
};

/** Nombre legible de un campo marcado («lineas[2].importe» → «línea 3: importe»). */
export function fieldLabel(path: string): string {
  const line = /^lineas\[(\d+)\](?:\.(\w+))?$/.exec(path);
  if (line) return `línea ${Number(line[1]) + 1}${line[2] ? `: ${LINE_FIELD_LABELS[line[2]] ?? line[2].replace(/_/g, " ")}` : ""}`;
  const tax = /^impuestos\[(\d+)\]/.exec(path);
  if (tax) return `impuesto ${Number(tax[1]) + 1}`;
  return FIELD_LABELS[path] ?? path.replace(/_/g, " ");
}

/** «2026-11» → «11/2026»; otros formatos quedan como se leyeron. */
export function formatPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${m[2]}/${m[1]}`;
  const r = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (r) return `${formatDate(r[1])} al ${formatDate(r[2])}`;
  return period;
}

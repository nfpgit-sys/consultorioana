import type { Queryable } from "@/lib/db/types";
import { addDays, endOfMonth, formatARS, formatQuantity, presetRange, todayAR } from "@/lib/domain/format";
import { resolveProductQuery } from "@/lib/domain/matching";
import { normalizeText } from "@/lib/domain/normalize";
import { parseDecimalAR, parseNumberWords } from "@/lib/domain/numbers";
import { type BaseUnit, COMMON_PRESENTATIONS, normalizePresentationName, resolvePhysicalUnit, toBaseQuantity } from "@/lib/domain/units";
import { EXPENSE_CATEGORIES } from "@/lib/services/expenses";
import { proposeExpense, proposeMovements, proposeProduct, proposePurchase, type ProposalResult } from "./proposals";
import { type CatalogProduct, consumptionSummary, expiringSoon, loadCatalog, lowStock, spendingSummary } from "./queries";
import type { AssistantReply, Proposal } from "./types";

/**
 * Intérprete sin IA para las instrucciones más frecuentes. Es conservador: si algo no queda
 * claro, pregunta o explica cómo decirlo; nunca registra nada sin la confirmación de la tarjeta.
 */

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export function parsePeriod(t: string, today = todayAR()): { from: string; to: string; label: string } {
  if (/\bayer\b/.test(t)) return { ...presetRange("ayer", today) };
  if (/\bhoy\b/.test(t)) return { ...presetRange("hoy", today) };
  if (/\bsemana pasada\b/.test(t)) {
    const start = addDays(presetRange("semana", today).from, -7);
    return { from: start, to: addDays(start, 6), label: "la semana pasada" };
  }
  if (/\b(esta semana|en la semana|semana)\b/.test(t)) return { ...presetRange("semana", today) };
  if (/\b(mes pasado|mes anterior|ultimo mes)\b/.test(t)) return { ...presetRange("mes_anterior", today) };
  if (/\b(este ano|en el ano|del ano|ano)\b/.test(t)) return { ...presetRange("anio", today) };
  const days = /\bultimos? (\d+) dias\b/.exec(t);
  if (days) return { from: addDays(today, -(Number(days[1]) - 1)), to: today, label: `los últimos ${days[1]} días` };
  for (const [name, month] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const year = Number(today.slice(0, 4));
      const currentMonth = Number(today.slice(5, 7));
      const y = month > currentMonth ? year - 1 : year;
      const from = `${y}-${String(month).padStart(2, "0")}-01`;
      const to = endOfMonth(from) > today ? today : endOfMonth(from);
      return { from, to, label: `${name} ${y}` };
    }
  }
  return { ...presetRange("mes", today) };
}

const CONSUME_RE =
  /\b(gaste|gastamos|gastaron|use|usamos|usaron|utilice|utilizamos|utilizaron|consumi|consumimos|consumieron|ocupe|ocupamos|saque|sacamos|desconta|descontar|descontame|baja de|se usaron|se uso|se gastaron|se gasto|se consumieron|se consumio)\b/;
const PURCHASE_RE = /\b(compre|compramos|compraron|se compro|se compraron|adquirimos)\b/;
const ADD_RE = /\b(agrega|agregar|agregame|suma|sumar|sumale|ingresa|ingresar|carga|cargar|cargame|entraron|entro|llegaron|llego|recibimos|recibi|anota|anotar)\b/;

const FILLER = new Set([
  "hoy",
  "ayer",
  "al",
  "a",
  "el",
  "la",
  "los",
  "las",
  "inventario",
  "stock",
  "por",
  "favor",
  "che",
  "me",
  "se",
  "nos",
  "registra",
  "registrar",
  "registrame",
  "un",
  "consumo",
  "ingreso",
  "en",
  "del",
  "que",
  "otra",
  "otro",
  "vez",
  "mas",
  "tambien",
  "porfa",
  "dale",
]);

interface ParsedItem {
  quantity: number;
  unitWord: string | null;
  productPhrase: string;
  rawPhrase: string;
}

function stripVerb(t: string, re: RegExp): string {
  return t.replace(re, " ").replace(/\s+/g, " ").trim();
}

function parseLeadingQuantity(tokens: string[]): { value: number; consumed: number } | null {
  if (tokens.length === 0) return null;
  const n = parseDecimalAR(tokens[0]);
  if (n !== null) return { value: n, consumed: 1 };
  return parseNumberWords(tokens);
}

/** Extrae "3 jeringas", "2 cajas de guantes", "500 g de alginato" de una frase. */
export function parseItems(text: string): ParsedItem[] {
  const segments = text
    .split(/,|;|\s+y\s+(?=(?:\d|un\b|una\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b|nueve\b|diez\b|media\b|medio\b))/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: ParsedItem[] = [];
  for (const seg of segments) {
    const tokens = seg.split(" ").filter((tk) => tk && !FILLER.has(tk));
    // Busca la primera cantidad en el segmento.
    let idx = 0;
    let qty: { value: number; consumed: number } | null = null;
    while (idx < tokens.length && !qty) {
      qty = parseLeadingQuantity(tokens.slice(idx));
      if (!qty) idx += 1;
    }
    if (!qty) continue;
    const rest = tokens.slice(idx + qty.consumed);
    if (rest.length === 0) continue;
    let unitWord: string | null = null;
    let productTokens = rest;
    const first = rest[0];
    const isUnitLike =
      resolvePhysicalUnit(first) !== null ||
      ["par", "pares"].includes(first) ||
      COMMON_PRESENTATIONS.map(normalizePresentationName).includes(normalizePresentationName(first));
    if (isUnitLike && rest.length > 1) {
      unitWord = first;
      productTokens = rest.slice(1);
      if (productTokens[0] === "de" || productTokens[0] === "del") productTokens = productTokens.slice(1);
    }
    const productPhrase = productTokens.filter((tk) => tk !== "de" || productTokens.length > 1).join(" ");
    items.push({ quantity: qty.value, unitWord, productPhrase, rawPhrase: rest.join(" ") });
  }
  return items;
}

type Resolution =
  | { ok: true; product: CatalogProduct; unit: string | null }
  | { ok: false; kind: "ambiguo"; options: CatalogProduct[]; phrase: string }
  | { ok: false; kind: "no_encontrado"; phrase: string; unitWord: string | null }
  | { ok: false; kind: "unidad"; product: CatalogProduct; unitWord: string; error: string };

function resolveItem(item: ParsedItem, catalog: CatalogProduct[]): Resolution {
  const tryResolve = (phrase: string) => (phrase ? resolveProductQuery(phrase, catalog) : null);
  if (item.unitWord) {
    const r = tryResolve(item.productPhrase);
    if (r?.status === "resuelto") {
      const conv = toBaseQuantity({ name: r.match.name, baseUnit: r.match.baseUnit, presentations: r.match.presentations }, item.quantity, item.unitWord);
      if (conv.ok) return { ok: true, product: r.match, unit: item.unitWord };
      // ¿La palabra era parte del nombre? ("3 jeringas descartables")
      const whole = tryResolve(item.rawPhrase);
      if (whole?.status === "resuelto") return { ok: true, product: whole.match, unit: null };
      return { ok: false, kind: "unidad", product: r.match, unitWord: item.unitWord, error: conv.error };
    }
    const whole = tryResolve(item.rawPhrase);
    if (whole?.status === "resuelto") return { ok: true, product: whole.match, unit: null };
    if (r?.status === "ambiguo") return { ok: false, kind: "ambiguo", options: r.options as CatalogProduct[], phrase: item.productPhrase };
    if (whole?.status === "ambiguo") return { ok: false, kind: "ambiguo", options: whole.options as CatalogProduct[], phrase: item.rawPhrase };
    return { ok: false, kind: "no_encontrado", phrase: item.productPhrase || item.rawPhrase, unitWord: item.unitWord };
  }
  const r = tryResolve(item.productPhrase);
  if (r?.status === "resuelto") return { ok: true, product: r.match, unit: null };
  if (r?.status === "ambiguo") return { ok: false, kind: "ambiguo", options: r.options as CatalogProduct[], phrase: item.productPhrase };
  return { ok: false, kind: "no_encontrado", phrase: item.productPhrase, unitWord: null };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const HELP = [
  "Podés pedirme, por ejemplo:",
  "• «Hoy gasté 3 jeringas» o «usamos 2 cajas de guantes»",
  "• «Agregá 20 jeringas al inventario»",
  "• «Compramos 5 tubos de pasta profiláctica por $12.000»",
  "• «¿Cuántos guantes quedan?» · «¿Qué productos están por agotarse?»",
  "• «Mostrame cuánto gastamos este mes» · «¿Qué vence pronto?»",
].join("\n");

function explainFailure(res: Exclude<Resolution, { ok: true }>, verb: "consumo" | "ingreso" | "compra"): string {
  if (res.kind === "ambiguo") {
    return `Hay varios productos que coinciden con «${res.phrase}»: ${res.options.map((o) => `«${o.name}»`).join(", ")}. Decime cuál, por ejemplo: «${verb === "consumo" ? "gasté" : verb === "compra" ? "compramos" : "agregá"} 3 ${res.options[0].name.toLowerCase()}».`;
  }
  if (res.kind === "unidad") return res.error;
  return `No encontré «${res.phrase}» en el inventario. Revisá el nombre o creá el producto desde Inventario.`;
}

export async function runLocalAssistant(q: Queryable, rawText: string): Promise<AssistantReply> {
  const t = normalizeText(rawText);
  const reply = (text: string, proposals: Proposal[] = []): AssistantReply => ({ reply: text, proposals, mode: "basico" });
  if (!t) return reply(HELP);

  if (/^(hola|buen dia|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(t) && t.split(" ").length <= 3) {
    return reply(`¡Hola! ${HELP}`);
  }
  if (/\b(ayuda|que podes hacer|que puedo pedir|como funciona|como te uso)\b/.test(t)) return reply(HELP);

  const isMutation = CONSUME_RE.test(t) || PURCHASE_RE.test(t) || ADD_RE.test(t);
  const hasQuantity = /\d/.test(t) || parseItems(t).length > 0;

  // Consultas
  if (/\bvenc/.test(t)) {
    const lots = await expiringSoon(q, 60);
    if (lots.length === 0) return reply("No hay lotes que venzan en los próximos 60 días.");
    return reply(
      `Vencimientos próximos (60 días):\n${lots.map((l) => `• ${l.producto} · lote ${l.lote ?? "s/n"} · ${l.cantidad_texto} · ${l.dias_restantes < 0 ? "vencido" : `vence en ${l.dias_restantes} días`}`).join("\n")}`,
    );
  }
  if (!isMutation && /(por agotarse|se (esta|estan) (acabando|terminando)|stock bajo|poco stock|agotad|\bfaltan?\b|hay que (comprar|reponer)|reponer|que (me|nos) falta)/.test(t)) {
    const list = await lowStock(q);
    if (list.length === 0) return reply("No hay productos con stock bajo ni agotados. 👍");
    return reply(`Productos para reponer:\n${list.map((p) => `• ${p.nombre}: ${p.stock_texto}${p.stock_minimo > 0 ? ` (mínimo ${formatQuantity(p.stock_minimo, p.unidad_base as BaseUnit)})` : ""}${p.estado === "agotado" ? " — agotado" : ""}`).join("\n")}`);
  }
  if (/\bcuant/.test(t) && /\b(consum|usamos|utilizamos|usaron)/.test(t)) {
    const period = parsePeriod(t);
    const rows = await consumptionSummary(q, period.from, period.to);
    if (rows.length === 0) return reply(`No hay consumos registrados en ${period.label}.`);
    const total = rows.reduce((a, r) => a + (r.costo_estimado ?? 0), 0);
    return reply(`Consumos de ${period.label}:\n${rows.slice(0, 10).map((r) => `• ${r.nombre}: ${r.consumido_texto}${r.costo_estimado !== null ? ` (${formatARS(r.costo_estimado)})` : ""}`).join("\n")}\nCosto estimado: ${formatARS(total)}.`);
  }
  if ((/\bcuant/.test(t) && /\b(gast|compr|invert|pagamos)/.test(t) && !/\d/.test(t)) || /\b(resumen de gastos|gastos (de|del) (este|el|la))\b/.test(t)) {
    const period = parsePeriod(t);
    const s = await spendingSummary(q, period.from, period.to);
    const lines = [
      `En ${period.label} se gastaron ${formatARS(s.total)}: ${formatARS(s.compras_de_materiales)} en compras de materiales y ${formatARS(s.gastos_generales)} en gastos generales.`,
    ];
    if (s.por_categoria.length) lines.push(s.por_categoria.slice(0, 8).map((c) => `• ${c.categoria}: ${formatARS(c.importe)}`).join("\n"));
    if (s.compras_sin_precio) lines.push(`Hay ${s.compras_sin_precio} compra(s) sin precio que todavía no suman.`);
    return reply(lines.join("\n"));
  }
  if (!isMutation && /\b(cuant[oa]s?|que cantidad|hay|queda|quedan|tenemos|tengo|stock de|disponible)\b/.test(t)) {
    const phrase = t
      .split(" ")
      .filter(
        (w) =>
          !/^(cuant[oa]s?|que|cantidad|de|del|hay|queda|quedan|tenemos|tengo|stock|en|el|la|los|las|inventario|disponibles?|nos|me|todavia|aun|sobran?|tiene|tienen|consultorio)$/.test(w),
      )
      .join(" ");
    if (!phrase) return reply("¿De qué producto querés saber el stock?");
    const catalog = await loadCatalog(q);
    const r = resolveProductQuery(phrase, catalog);
    if (r.status === "resuelto") {
      const p = r.match;
      return reply(
        `De «${p.name}» quedan ${formatQuantity(p.currentStock, p.baseUnit)}${p.status === "agotado" ? " (agotado)" : p.status === "bajo" ? ` (stock bajo; mínimo ${formatQuantity(p.minStock, p.baseUnit)})` : ""}.`,
      );
    }
    if (r.status === "ambiguo") {
      return reply(`Encontré varios:\n${(r.options as CatalogProduct[]).map((p) => `• ${p.name}: ${formatQuantity(p.currentStock, p.baseUnit)}`).join("\n")}`);
    }
    return reply(`No encontré «${phrase}» en el inventario.`);
  }

  // Gastos generales: «pagamos la luz $45.000», «registrá un gasto de alquiler de 300000»
  if (!CONSUME_RE.test(t) && !PURCHASE_RE.test(t) && /\b(gasto|pague|pagamos|abonamos|abone)\b/.test(t)) {
    const amountMatch = /(\d[\d.]*)/.exec(t);
    const amount = amountMatch ? parseDecimalAR(amountMatch[1]) : null;
    if (amount === null || amount <= 0) return reply("¿De cuánto fue el gasto? Por ejemplo: «pagamos la luz $45.000».");
    const words = t.split(" ");
    const category =
      EXPENSE_CATEGORIES.find((c) => normalizeText(c).split(" ").some((w) => w.length > 2 && words.includes(w))) ?? "Otros";
    const result = await proposeExpense(q, {
      expenseDate: /\bayer\b/.test(t) ? addDays(todayAR(), -1) : todayAR(),
      category,
      description: capitalize(rawText.trim()).slice(0, 300),
      amount,
      supplierName: null,
    });
    if (!result.ok) return reply(result.errors.join(" "));
    return reply(`Te preparé el gasto en la categoría «${category}». Si no es correcta, cancelá y registralo desde Gastos.`, [result.proposal]);
  }

  // Operaciones
  if (isMutation && hasQuantity) {
    const kind: "consumo" | "ingreso" | "compra" = CONSUME_RE.test(t) ? "consumo" : PURCHASE_RE.test(t) ? "compra" : "ingreso";
    const effectiveDate = /\bayer\b/.test(t) ? addDays(todayAR(), -1) : null;
    const verbRe = kind === "consumo" ? CONSUME_RE : kind === "compra" ? PURCHASE_RE : ADD_RE;
    // Precio para compras: "$12.000", "por 12000 pesos", "a 1200 cada una"
    let price: { amount: number; each: boolean } | null = null;
    let textForItems = stripVerb(t, verbRe);
    if (kind === "compra") {
      const raw = normalizeText(rawText.replace(/\$\s*/g, " zzprecio "));
      const m = /(?:zzprecio\s*([\d.]+)|(?:por|a|en|pagamos|pague)\s+([\d.]+)\s*(?:pesos|\$)?)(\s*(cada (una|uno)|c u|por unidad))?/.exec(raw);
      if (m) {
        const amount = parseDecimalAR(m[1] ?? m[2]);
        if (amount !== null) price = { amount, each: Boolean(m[3]) };
      }
      textForItems = stripVerb(textForItems.replace(/\b(por|a|en|pagamos|pague)\s+[\d.]+\s*(pesos)?(\s*(cada (una|uno)|c u|por unidad))?/g, " "), /\$/g);
    }
    const items = parseItems(textForItems);
    if (items.length === 0) return reply(`No pude identificar cantidades y productos. ${HELP}`);
    const catalog = await loadCatalog(q);
    const resolved = items.map((i) => ({ item: i, res: resolveItem(i, catalog) }));
    const failures = resolved.filter((r) => !r.res.ok);

    if (kind === "ingreso" && failures.length === 1 && items.length === 1 && failures[0].res.ok === false && failures[0].res.kind === "no_encontrado") {
      // «Agregá 20 jeringas al inventario» con un producto que no existe: se propone crearlo.
      const item = items[0];
      const physical = item.unitWord ? resolvePhysicalUnit(item.unitWord) : null;
      if (item.unitWord && !physical) {
        return reply(
          `No encontré «${item.productPhrase}» en el inventario. Si querés crearlo, decime cómo se mide (por ejemplo «agregá 200 unidades de ${item.productPhrase}») y después definimos cuántas unidades trae cada ${item.unitWord}.`,
        );
      }
      const name = capitalize(item.productPhrase);
      const result = await proposeProduct(q, {
        name,
        category: null,
        baseUnit: physical ?? "unidad",
        initialStock: item.quantity,
        minStock: 0,
        unitCost: null,
        tracksExpiry: false,
        presentations: [],
      });
      if (!result.ok) return reply(result.errors.join(" "));
      return reply(
        `«${name}» no está en el inventario. Te propongo crearlo con ${formatQuantity(item.quantity, physical ?? "unidad")}. Revisá el nombre (podés editarlo) y confirmá.`,
        [result.proposal],
      );
    }
    if (failures.length > 0) {
      return reply(failures.map((f) => explainFailure(f.res as Exclude<Resolution, { ok: true }>, kind)).join("\n"));
    }

    let result: ProposalResult;
    if (kind === "compra") {
      const ok = resolved as { item: ParsedItem; res: Extract<Resolution, { ok: true }> }[];
      result = await proposePurchase(q, {
        supplierName: null,
        purchaseDate: effectiveDate ?? todayAR(),
        docNumber: null,
        items: ok.map(({ item, res }, idx) => ({
          productId: res.product.id,
          description: null,
          quantity: item.quantity,
          unit: res.unit,
          unitPrice: price && price.each && idx === 0 ? price.amount : null,
          lineTotal: price && !price.each && ok.length === 1 ? price.amount : null,
        })),
        total: price && !price.each && ok.length > 1 ? price.amount : null,
      });
    } else {
      result = await proposeMovements(q, {
        items: (resolved as { item: ParsedItem; res: Extract<Resolution, { ok: true }> }[]).map(({ item, res }) => ({
          productId: res.product.id,
          quantity: item.quantity,
          unit: res.unit,
          kind,
          reason: null,
        })),
        effectiveDate,
      });
    }
    if (!result.ok) return reply(result.errors.join(" "));
    const p = result.proposal;
    const intro =
      p.type === "compra" && p.pendingPrice
        ? "Te preparé la compra. No me dijiste el precio: completalo en la tarjeta o confirmá sin precio y queda pendiente."
        : "Revisá y confirmá para registrarlo.";
    return reply(intro, [p]);
  }

  if (isMutation) return reply("¿Cuántas unidades y de qué producto? Por ejemplo: «gasté 3 jeringas».");
  return reply(`No entendí el pedido. ${HELP}`);
}

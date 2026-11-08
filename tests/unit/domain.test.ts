import { describe, expect, it } from "vitest";
import { normalizeName, normalizeText, singularize } from "@/lib/domain/normalize";
import { parseDecimalAR, parseNumberWords } from "@/lib/domain/numbers";
import { convertPhysical, resolvePhysicalUnit, toBaseQuantity, type ProductUnitInfo } from "@/lib/domain/units";
import {
  classifyInvoiceLine,
  findNearDuplicates,
  resolveProductQuery,
} from "@/lib/domain/matching";
import { addMonths, endOfMonth, formatARS, presetRange, startOfWeek, todayAR } from "@/lib/domain/format";

describe("normalización de nombres", () => {
  it("ignora mayúsculas, acentos, plurales y espacios entre número y unidad", () => {
    expect(normalizeName("Jeringas descartables 5ml")).toBe(normalizeName("jeringa DESCARTABLE 5 ml"));
    expect(normalizeName("Anestésico Lidocaína")).toBe("anestesico lidocaina");
    expect(normalizeText("Pasta  Profiláctica (tubo)")).toBe("pasta profilactica tubo");
  });

  it("no confunde tamaños distintos", () => {
    expect(normalizeName("Jeringa 5 ml")).not.toBe(normalizeName("Jeringa 10 ml"));
  });

  it("mantiene 'con' y 'sin' porque cambian el producto", () => {
    expect(normalizeName("Guantes de látex")).not.toBe(normalizeName("Guantes sin látex"));
  });

  it("singulariza en español", () => {
    expect(singularize("jeringas")).toBe("jeringa");
    expect(singularize("guantes")).toBe("guante");
    expect(singularize("algodones")).toBe("algodon");
    expect(singularize("unidades")).toBe("unidad");
    expect(singularize("lapices")).toBe("lapiz");
  });
});

describe("números en formato argentino", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1234,56", 1234.56],
    ["2,5", 2.5],
    ["2.5", 2.5],
    ["1.500", 1500],
    ["12.000.000", 12000000],
    ["$ 12.000", 12000],
    ["1,234.56", 1234.56],
    ["15", 15],
    ["0,75", 0.75],
  ])("%s -> %d", (input, expected) => {
    expect(parseDecimalAR(input)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3,4,5", "--3", "1,23,4"])("rechaza %j", (input) => {
    expect(parseDecimalAR(input)).toBeNull();
  });

  it("lee números dictados en palabras", () => {
    expect(parseNumberWords(["tres", "jeringas"])).toEqual({ value: 3, consumed: 1 });
    expect(parseNumberWords(["veinte"])).toEqual({ value: 20, consumed: 1 });
    expect(parseNumberWords(["treinta", "y", "dos", "guantes"])).toEqual({ value: 32, consumed: 3 });
    expect(parseNumberWords(["ciento", "veinte"])).toEqual({ value: 120, consumed: 2 });
    expect(parseNumberWords(["media", "docena"])).toEqual({ value: 6, consumed: 2 });
    expect(parseNumberWords(["una", "caja"])).toEqual({ value: 1, consumed: 1 });
    expect(parseNumberWords(["guantes"])).toBeNull();
  });
});

describe("unidades y conversiones", () => {
  const guantes: ProductUnitInfo = {
    name: "Guantes de látex",
    baseUnit: "unidad",
    presentations: [{ name: "Caja", factor: 100 }],
  };
  const composite: ProductUnitInfo = { name: "Composite A2", baseUnit: "g", presentations: [{ name: "jeringa", factor: 4 }] };

  it("convierte presentaciones definidas, también en plural", () => {
    expect(toBaseQuantity(guantes, 2, "cajas")).toMatchObject({ ok: true, baseQuantity: 200, kind: "presentacion" });
    expect(toBaseQuantity(composite, 3, "jeringas")).toMatchObject({ ok: true, baseQuantity: 12 });
  });

  it("usa la unidad base cuando no se indica unidad", () => {
    expect(toBaseQuantity(guantes, 3, "")).toMatchObject({ ok: true, baseQuantity: 3, kind: "base" });
    expect(toBaseQuantity(guantes, 3, "unidades")).toMatchObject({ ok: true, baseQuantity: 3 });
  });

  it("convierte unidades físicas de la misma magnitud", () => {
    expect(toBaseQuantity(composite, 0.5, "kg")).toMatchObject({ ok: true, baseQuantity: 500, kind: "fisica" });
    expect(convertPhysical(1500, "ml", "l")).toBe(1.5);
    expect(resolvePhysicalUnit("Gramos")).toBe("g");
    expect(resolvePhysicalUnit("cc")).toBe("ml");
  });

  it("no inventa equivalencias", () => {
    const r = toBaseQuantity(guantes, 1, "paquete");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("unidad_desconocida");
      expect(r.error).toContain("paquete");
    }
  });

  it("no mezcla magnitudes incompatibles", () => {
    const r = toBaseQuantity(composite, 2, "ml");
    expect(r).toMatchObject({ ok: false, code: "unidad_incompatible" });
    const r2 = toBaseQuantity(guantes, 2, "g");
    expect(r2).toMatchObject({ ok: false, code: "unidad_incompatible" });
  });

  it("rechaza cantidades inválidas o que se redondean a cero", () => {
    expect(toBaseQuantity(guantes, 0, "")).toMatchObject({ ok: false, code: "cantidad_invalida" });
    expect(toBaseQuantity(guantes, -2, "")).toMatchObject({ ok: false, code: "cantidad_invalida" });
    expect(toBaseQuantity({ name: "Alginato", baseUnit: "kg", presentations: [] }, 0.1, "mg")).toMatchObject({
      ok: false,
      code: "cantidad_muy_chica",
    });
  });
});

describe("identificación de productos", () => {
  const catalog = [
    { id: "1", name: "Jeringa descartable 5 ml" },
    { id: "2", name: "Jeringa descartable 10 ml" },
    { id: "3", name: "Guantes de látex talle M" },
    { id: "4", name: "Guantes de nitrilo talle S" },
    { id: "5", name: "Pasta profiláctica" },
    { id: "6", name: "Aguja dental 27G corta" },
    { id: "7", name: "Anestesia lidocaína 2% (cartucho)" },
  ];

  it("resuelve cuando hay un único candidato claro", () => {
    expect(resolveProductQuery("pasta profilactica", catalog)).toMatchObject({ status: "resuelto", match: { id: "5" } });
    expect(resolveProductQuery("jeringas de 5 ml", catalog)).toMatchObject({ status: "resuelto", match: { id: "1" } });
    expect(resolveProductQuery("guantes de nitrilo", catalog)).toMatchObject({ status: "resuelto", match: { id: "4" } });
  });

  it("pregunta cuando hay varias opciones parecidas", () => {
    const r = resolveProductQuery("jeringas", catalog);
    expect(r.status).toBe("ambiguo");
    if (r.status === "ambiguo") expect(r.options.map((o) => o.id).sort()).toEqual(["1", "2"]);
    expect(resolveProductQuery("guantes", catalog).status).toBe("ambiguo");
  });

  it("no encuentra productos inexistentes", () => {
    expect(resolveProductQuery("hilo dental", catalog).status).toBe("sin_coincidencia");
  });

  it("relaciona descripciones abreviadas de facturas sin confundir tamaños", () => {
    const line = classifyInvoiceLine(["JER DESC 5ML C/AG X100 U"], catalog);
    expect(line.best?.candidate.id).toBe("1");
    const wrongSize = classifyInvoiceLine(["JERINGA DESCARTABLE 20 ML"], catalog);
    expect(["dudosa", "sin_coincidencia"]).toContain(wrongSize.status);
    expect(wrongSize.status === "segura").toBe(false);
  });

  it("marca como segura una coincidencia aprendida por alias", () => {
    const withAlias = catalog.map((c) => (c.id === "7" ? { ...c, aliases: ["lido 2 carp x50"] } : c));
    const line = classifyInvoiceLine(["LIDO 2% CARP X50"], withAlias);
    expect(line).toMatchObject({ status: "segura", best: { candidate: { id: "7" }, via: "alias" } });
  });

  it("detecta casi duplicados al crear productos", () => {
    expect(findNearDuplicates("Jeringas descartables 5ml", catalog).map((r) => r.candidate.id)).toEqual(["1"]);
    expect(findNearDuplicates("Jeringa descartable 3 ml", catalog)).toEqual([]);
    expect(findNearDuplicates("Hilo dental", catalog)).toEqual([]);
  });
});

describe("fechas y moneda", () => {
  it("usa la fecha de Buenos Aires aunque en UTC ya sea el día siguiente", () => {
    expect(todayAR(new Date("2026-11-08T02:39:00Z"))).toBe("2026-11-07");
    expect(todayAR(new Date("2026-11-08T03:00:00Z"))).toBe("2026-11-08");
  });

  it("calcula períodos", () => {
    expect(presetRange("mes", "2026-11-07")).toMatchObject({ from: "2026-11-01", to: "2026-11-07" });
    expect(presetRange("mes_anterior", "2026-03-31")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("formatea pesos argentinos", () => {
    expect(formatARS(1234.5).replace(/\s/g, " ")).toBe("$ 1.234,50");
  });
});

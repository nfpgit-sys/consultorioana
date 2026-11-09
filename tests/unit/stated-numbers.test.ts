import { describe, expect, it } from "vitest";
import { isStatedEquivalence, statedEquivalenceNumbers } from "@/lib/agent/stated-numbers";

describe("equivalencias dichas por la persona", () => {
  it("la cantidad de la presentación no cuenta como equivalencia («usamos 2 cajas»)", () => {
    expect(statedEquivalenceNumbers(["usamos 2 cajas de mascarillas"], "caja")).toEqual([]);
    expect(isStatedEquivalence(["usamos 2 cajas de mascarillas"], "caja", 1)).toBe(false);
    expect(isStatedEquivalence(["usamos 2 cajas de mascarillas"], "caja", 2)).toBe(false);
    expect(isStatedEquivalence(["usamos dos cajas de mascarillas"], "caja", 2)).toBe(false);
  });

  it("reconoce las formas habituales de decir cuánto trae", () => {
    expect(isStatedEquivalence(["Agregá dos cajas de guantes, cada caja tiene 100 unidades"], "caja", 100)).toBe(true);
    expect(isStatedEquivalence(["compramos 3 cajas x50 de guantes"], "caja", 50)).toBe(true);
    expect(isStatedEquivalence(["2 cajas de 50"], "caja", 50)).toBe(true);
    expect(isStatedEquivalence(["trae cien"], "caja", 100)).toBe(true);
    expect(isStatedEquivalence(["50"], "caja", 50)).toBe(true);
    expect(isStatedEquivalence(["cada caja trae media docena"], "caja", 6)).toBe(true);
    expect(isStatedEquivalence(["el pomo trae 4,5 g"], "pomo", 4.5)).toBe(true);
    expect(isStatedEquivalence(["la caja viene de 1.000"], "caja", 1000)).toBe(true);
  });

  it("no acepta artículos ni números que la persona no dijo", () => {
    expect(isStatedEquivalence(["usamos una caja de guantes"], "caja", 1)).toBe(false);
    expect(isStatedEquivalence(["cada caja trae 100"], "caja", 10)).toBe(false);
    expect(isStatedEquivalence([], "caja", 100)).toBe(false);
  });

  it("toma la respuesta en un mensaje posterior", () => {
    expect(isStatedEquivalence(["usamos 2 cajas de mascarillas", "trae 50"], "caja", 50)).toBe(true);
  });
});

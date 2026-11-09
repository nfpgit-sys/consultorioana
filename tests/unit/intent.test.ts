import { describe, expect, it } from "vitest";
import { statedMovementKinds } from "@/lib/agent/intent";

const kinds = (...t: string[]) => [...statedMovementKinds(t)].sort();

describe("¿consumo o ingreso? (error 3 de la auditoría)", () => {
  it("no supone nada si el mensaje no lo dice", () => {
    expect(kinds("jeringas 5")).toEqual([]);
    expect(kinds("5 jeringas")).toEqual([]);
    expect(kinds("guantes, dos cajas")).toEqual([]);
    expect(kinds("¿cuántas jeringas quedan?")).toEqual([]);
  });

  it("reconoce consumos en distintas formas", () => {
    for (const t of ["hoy gasté 3 jeringas", "oy gaste 2 geringas", "usamos 2 cajas", "se usaron 4", "che, se nos fueron media docena", "ocupamos 3 guantes", "descontá 2", "tiramos 3 vencidas", "se rompió una", "jeringas 5 usadas", "consumo", "fue un consumo"]) {
      expect(kinds(t), t).toEqual(["consumo"]);
    }
  });

  it("reconoce ingresos en distintas formas", () => {
    for (const t of ["agregá 10 jeringas", "sumá 5", "llegaron 3 cajas", "entraron 2", "nos regalaron 10", "cargá 20 guantes", "ingreso", "es un ingreso"]) {
      expect(kinds(t), t).toEqual(["ingreso"]);
    }
  });

  it("toma la aclaración en el mensaje siguiente", () => {
    expect(kinds("jeringas 5", "las usamos")).toEqual(["consumo"]);
    expect(kinds("jeringas 5", "entraron")).toEqual(["ingreso"]);
  });
});

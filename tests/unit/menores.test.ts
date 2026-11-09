import { describe, expect, it } from "vitest";
import { cleanAiReply } from "@/lib/agent/reply";
import { isAffirmative, offeredEquivalenceNumbers } from "@/lib/agent/stated-numbers";
import { matchesDeclaredType } from "@/lib/invoices/file-signature";
import { buildCsp } from "@/proxy";

describe("«sí» a una equivalencia ofrecida (punto 1)", () => {
  it("reconoce respuestas afirmativas y no las negativas", () => {
    for (const t of ["sí", "Si", "sí, 1", "exacto", "correcto", "así es", "dale", "ok"]) expect(isAffirmative(t), t).toBe(true);
    for (const t of ["no", "eso no", "no sé", "trae 4", "sí, pero no"]) expect(isAffirmative(t), t).toBe(false);
  });

  it("lee la equivalencia que ofreció el asistente para esa presentación", () => {
    const q = "¿Cuántas unidades base trae cada tubo (o es 1 tubo = 1 unidad)? Y contame cuánto se pagó.";
    expect(offeredEquivalenceNumbers(q, "tubo")).toEqual([1]);
    expect(offeredEquivalenceNumbers("¿cada caja trae 100?", "caja")).toEqual([100]);
    expect(offeredEquivalenceNumbers(q, "caja")).toEqual([]);
    expect(offeredEquivalenceNumbers("¿Cuántas unidades trae cada tubo?", "tubo")).toEqual([]);
  });
});

describe("respuestas de la IA en texto plano (punto 3)", () => {
  it("quita el formato markdown", () => {
    expect(cleanAiReply("Encontré **Pasta de dientes** con `1` unidad.\n* uno\n- dos\n## Título", true)).toBe(
      "Encontré Pasta de dientes con 1 unidad.\n• uno\n• dos\nTítulo",
    );
    expect(cleanAiReply("Es *muy* importante.", true)).toBe("Es muy importante.");
  });

  it("sin tarjetas, quita las frases que mandan a revisar una tarjeta", () => {
    expect(cleanAiReply("• Pasta de dientes: 1 unidad (mínimo: 2). Revisá la tarjeta para ver los detalles.", false)).toBe(
      "• Pasta de dientes: 1 unidad (mínimo: 2).",
    );
    expect(cleanAiReply("Te preparé el consumo. Revisá la tarjeta.", true)).toBe("Te preparé el consumo. Revisá la tarjeta.");
  });
});

describe("firma real de los archivos (punto 4)", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const text = (s: string) => new TextEncoder().encode(s);
  it("acepta archivos genuinos", () => {
    expect(matchesDeclaredType("application/pdf", text("%PDF-1.7\n..."))).toBe(true);
    expect(matchesDeclaredType("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesDeclaredType("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(matchesDeclaredType("image/webp", text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe(true);
  });
  it("rechaza contenido que no coincide con el tipo declarado", () => {
    expect(matchesDeclaredType("application/pdf", text("no soy un pdf"))).toBe(false);
    expect(matchesDeclaredType("image/jpeg", text("<html>"))).toBe(false);
    expect(matchesDeclaredType("image/png", bytes(0xff, 0xd8, 0xff))).toBe(false);
    expect(matchesDeclaredType("application/x-msdownload", text("MZ"))).toBe(false);
  });
});

describe("política de seguridad de contenido (punto 6)", () => {
  it("solo permite scripts propios con nonce y bloquea marcos, objetos y orígenes externos", () => {
    const csp = buildCsp("abc123", true);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'", "upgrade-insecure-requests"]) {
      expect(csp).toContain(d);
    }
    expect(buildCsp("x", false)).not.toContain("upgrade-insecure-requests");
  });
});

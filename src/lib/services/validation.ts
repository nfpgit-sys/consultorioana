import { z } from "zod";
import { isValidIsoDate, todayAR } from "@/lib/domain/format";

export const isoDate = z
  .string()
  .trim()
  .refine(isValidIsoDate, { message: "Fecha inválida (formato AAAA-MM-DD)." });

/** Fecha que no puede estar en el futuro (según la hora de Buenos Aires). */
export const pastOrTodayDate = isoDate.refine((d) => d <= todayAR(), {
  message: "La fecha no puede ser posterior a hoy.",
});

export const uuid = z.uuid({ message: "Identificador inválido." });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Máximo ${max} caracteres.` })
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const quantity = z
  .number({ message: "Ingresá una cantidad válida." })
  .finite()
  .positive({ message: "La cantidad tiene que ser mayor que cero." })
  .max(1_000_000_000, { message: "Cantidad demasiado grande." });

export const money = z
  .number({ message: "Ingresá un importe válido." })
  .finite()
  .min(0, { message: "El importe no puede ser negativo." })
  .max(10_000_000_000, { message: "Importe demasiado grande." });

/** Primer mensaje de error de Zod, para mostrarlo en la UI. */
export function firstZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

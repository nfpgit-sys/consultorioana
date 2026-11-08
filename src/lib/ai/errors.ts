import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";

export type AiErrorKind = "clave" | "permiso" | "limite" | "modelo" | "region" | "conexion" | "demora" | "servicio" | "rechazo" | "desconocido";

export interface AiErrorInfo {
  kind: AiErrorKind;
  /** Frase en minúscula para insertar en un mensaje: "No se pudo usar la IA (<message>)". */
  message: string;
}

const info = (kind: AiErrorKind, message: string): AiErrorInfo => ({ kind, message });

/** Traduce errores de Gemini o Claude a una explicación breve en español, sin datos sensibles. */
export function describeAiError(err: unknown): AiErrorInfo {
  if (err instanceof GeminiApiError) {
    const body = String(err.message ?? "");
    if (err.status === 429) {
      return info("limite", "se alcanzó el límite de uso de Gemini; el plan gratuito permite pocas consultas por minuto y por día");
    }
    if (/API[_ ]KEY[_ ]INVALID|API key not valid|API key expired/i.test(body) || err.status === 401) {
      return info("clave", "la clave de Gemini no es válida");
    }
    if (/location is not supported|not available in your country|User location/i.test(body)) {
      return info("region", "Gemini no está disponible desde la región del servidor");
    }
    if (err.status === 403) return info("permiso", "la clave de Gemini no tiene permiso para usar este modelo");
    if (err.status === 404) return info("modelo", "el modelo de IA configurado no existe o fue retirado");
    if (err.status >= 500) return info("servicio", "Gemini no está disponible en este momento");
    return info("rechazo", "el servicio de IA rechazó el pedido");
  }
  if (err instanceof Anthropic.AuthenticationError) return info("clave", "la clave de IA no es válida");
  if (err instanceof Anthropic.PermissionDeniedError) return info("permiso", "la clave de IA no tiene permisos para este modelo");
  if (err instanceof Anthropic.RateLimitError) return info("limite", "se alcanzó el límite de uso de la IA");
  if (err instanceof Anthropic.NotFoundError) return info("modelo", "el modelo de IA configurado no existe o fue retirado");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return info("demora", "la IA tardó demasiado en responder");
  if (err instanceof Anthropic.APIConnectionError) return info("conexion", "no hubo conexión con el servicio de IA");
  if (err instanceof Anthropic.BadRequestError) return info("rechazo", "el servicio de IA rechazó el pedido");
  if (err instanceof Anthropic.APIError) {
    return (err.status ?? 0) >= 500
      ? info("servicio", "el servicio de IA no está disponible en este momento")
      : info("rechazo", `el servicio de IA respondió con error ${err.status ?? ""}`.trim());
  }
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return info("demora", "la IA tardó demasiado en responder");
    if (err.name === "TypeError" && /fetch failed|network|ECONN|ENOTFOUND/i.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? "")}`)) {
      return info("conexion", "no hubo conexión con el servicio de IA");
    }
  }
  return info("desconocido", "ocurrió un error inesperado con la IA");
}

/** Error con un mensaje ya pensado para mostrar a la persona (por ejemplo en la revisión de facturas). */
export class AiUserError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind = "desconocido",
  ) {
    super(message);
    this.name = "AiUserError";
  }
}

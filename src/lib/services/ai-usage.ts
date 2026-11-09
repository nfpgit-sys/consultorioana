import { ApiError as GeminiApiError } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { APP_TIME_ZONE } from "@/lib/constants";
import type { Queryable } from "@/lib/db/types";

export type AiUsageKind = "asistente" | "factura";
export type AiCallOutcome = "ok" | "limite" | "error";

export interface AiUsageTag {
  provider: string;
  model: string;
  kind: AiUsageKind;
}

export function outcomeOf(err: unknown): AiCallOutcome {
  if (err instanceof GeminiApiError && err.status === 429) return "limite";
  if (err instanceof Anthropic.RateLimitError) return "limite";
  return "error";
}

/**
 * Suma una consulta al proveedor de IA en el minuto actual. Nunca hace fallar el pedido:
 * si no se puede registrar, solo queda en el log.
 */
export async function recordAiCall(q: Queryable, tag: AiUsageTag, outcome: AiCallOutcome): Promise<void> {
  try {
    await q.query(
      `insert into ai_usage (minute, provider, model, kind, requests, limited, errors)
       values (date_trunc('minute', now()), $1, $2, $3, 1, $4, $5)
       on conflict (minute, provider, model, kind) do update
         set requests = ai_usage.requests + 1,
             limited = ai_usage.limited + excluded.limited,
             errors = ai_usage.errors + excluded.errors`,
      [tag.provider, tag.model, tag.kind, outcome === "limite" ? 1 : 0, outcome === "error" ? 1 : 0],
    );
  } catch (err) {
    console.error("[ia] no se pudo registrar el uso:", err instanceof Error ? err.message : err);
  }
}

/** Ejecuta una llamada al proveedor y registra el resultado (ok, límite o error). */
export async function trackAiCall<T>(q: Queryable | undefined, tag: AiUsageTag, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call();
    if (q) await recordAiCall(q, tag, "ok");
    return result;
  } catch (err) {
    if (q) await recordAiCall(q, tag, outcomeOf(err));
    throw err;
  }
}

export interface AiUsageDay {
  day: string;
  requests: number;
  limited: number;
  errors: number;
  peakPerMinute: number;
}

export interface AiUsageSummary {
  days: AiUsageDay[];
  today: AiUsageDay;
  lastLimitedAt: string | null;
}

/** Uso de los últimos 7 días (hora de Buenos Aires), con el pico de consultas en un mismo minuto. */
export async function aiUsageSummary(q: Queryable): Promise<AiUsageSummary> {
  const rows = await q.query<{ day: string; requests: number; limited: number; errors: number; peak: number }>(
    `with per_minute as (
       select minute, sum(requests)::int as requests, sum(limited)::int as limited, sum(errors)::int as errors
       from ai_usage
       where minute >= now() - interval '8 days'
       group by minute
     )
     select to_char((minute at time zone $1)::date, 'YYYY-MM-DD') as day,
            sum(requests)::int as requests, sum(limited)::int as limited, sum(errors)::int as errors, max(requests)::int as peak
     from per_minute
     where (minute at time zone $1)::date > (now() at time zone $1)::date - 7
     group by 1
     order by 1 desc`,
    [APP_TIME_ZONE],
  );
  const [todayRow] = await q.query<{ day: string }>(`select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as day`, [APP_TIME_ZONE]);
  const [last] = await q.query<{ at: string | null }>(`select max(minute) as at from ai_usage where limited > 0`);
  const days = rows.map((r) => ({ day: r.day, requests: r.requests, limited: r.limited, errors: r.errors, peakPerMinute: r.peak }));
  const today = days.find((d) => d.day === todayRow.day) ?? { day: todayRow.day, requests: 0, limited: 0, errors: 0, peakPerMinute: 0 };
  return { days, today, lastLimitedAt: last?.at ?? null };
}

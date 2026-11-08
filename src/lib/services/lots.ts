import type { Queryable } from "@/lib/db/types";
import { addDays, todayAR } from "@/lib/domain/format";
import { toNumber } from "@/lib/domain/numbers";
import type { BaseUnit } from "@/lib/domain/units";
import type { Lot } from "./types";
import { uuid } from "./validation";

export async function listLots(q: Queryable, productId: string, opts: { includeEmpty?: boolean } = {}): Promise<Lot[]> {
  if (!uuid.safeParse(productId).success) return [];
  const rows = await q.query<{ id: string; product_id: string; lot_code: string | null; expires_on: string | null; quantity: string }>(
    `select id, product_id, lot_code, expires_on, quantity from lots
     where product_id = $1 ${opts.includeEmpty ? "" : "and quantity > 0"}
     order by expires_on asc nulls last, created_at asc`,
    [productId],
  );
  return rows.map((r) => ({ id: r.id, productId: r.product_id, lotCode: r.lot_code, expiresOn: r.expires_on, quantity: toNumber(r.quantity) }));
}

export interface ExpiringLot extends Lot {
  productName: string;
  baseUnit: BaseUnit;
  daysLeft: number;
}

/** Lotes con stock que vencen dentro de `days` días (incluye los ya vencidos). */
export async function listExpiringLots(q: Queryable, days = 60, today = todayAR()): Promise<ExpiringLot[]> {
  const rows = await q.query<{
    id: string;
    product_id: string;
    product_name: string;
    base_unit: BaseUnit;
    lot_code: string | null;
    expires_on: string;
    quantity: string;
  }>(
    `select l.id, l.product_id, p.name as product_name, p.base_unit, l.lot_code, l.expires_on, l.quantity
     from lots l join products p on p.id = l.product_id
     where l.quantity > 0 and l.expires_on is not null and l.expires_on <= $1::date
       and p.archived_at is null and p.tracks_expiry
     order by l.expires_on asc`,
    [addDays(today, days)],
  );
  const t = new Date(`${today}T00:00:00Z`).getTime();
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    baseUnit: r.base_unit,
    lotCode: r.lot_code,
    expiresOn: r.expires_on,
    quantity: toNumber(r.quantity),
    daysLeft: Math.round((new Date(`${r.expires_on}T00:00:00Z`).getTime() - t) / 86_400_000),
  }));
}

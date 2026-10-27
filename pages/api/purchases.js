import { randomUUID } from 'node:crypto'
import { purchaseSchema } from '../../lib/validation'
import { apiError, requireUser } from '../../lib/supabase-server'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = purchaseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá la fecha, los productos, las cantidades y los precios.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { idempotency_key: idempotencyKey, ...purchase } = parsed.data
  const { data, error } = await auth.supabase.rpc('confirm_purchase', { p_purchase: purchase, p_idempotency_key: idempotencyKey || randomUUID() })
  if (error) return apiError(res, error)
  return res.status(201).json({ purchase: data, message: 'Compra, gasto y entrada de stock confirmados.' })
}
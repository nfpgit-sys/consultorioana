import { movementSchema } from '../../lib/validation'
import { apiError, requireUser } from '../../lib/supabase-server'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = movementSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá el tipo y la cantidad del movimiento.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.supabase.rpc('record_stock_movement', {
    p_product_id: parsed.data.product_id,
    p_movement_type: parsed.data.movement_type,
    p_quantity: parsed.data.quantity ?? null,
    p_absolute_stock: parsed.data.absolute_stock ?? null,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note || null,
    p_idempotency_key: parsed.data.idempotency_key || null,
  })
  if (error) return apiError(res, error)
  return res.status(200).json({ movement: data })
}
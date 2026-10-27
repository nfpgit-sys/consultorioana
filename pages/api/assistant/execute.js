import { z } from 'zod'
import { apiError, requireUser } from '../../../lib/supabase-server'

const schema = z.object({
  intent: z.enum(['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock']),
  product_id: z.string().uuid(),
  quantity: z.number().positive().max(100000000).optional(),
  total_amount_ars: z.number().nonnegative().max(100000000000).optional(),
  unit_price_ars: z.number().nonnegative().max(100000000000).optional(),
  purchase_date: z.string().date().optional(),
  supplier_name: z.string().trim().max(120).nullable().optional(),
  idempotency_key: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.intent === 'set_stock') {
    if (value.quantity === undefined) context.addIssue({ code: 'custom', message: 'Falta la cantidad absoluta.', path: ['quantity'] })
  } else if (value.quantity === undefined) context.addIssue({ code: 'custom', message: 'Falta la cantidad.', path: ['quantity'] })
  if (value.intent === 'purchase_stock' && value.total_amount_ars === undefined && value.unit_price_ars === undefined) context.addIssue({ code: 'custom', message: 'Falta el importe de compra.' })
})

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'La operación no tiene todos los datos requeridos.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const intent = parsed.data
  if (intent.intent === 'purchase_stock') {
    const unitPrice = intent.unit_price_ars ?? intent.total_amount_ars / intent.quantity
    const purchase = {
      purchase_date: intent.purchase_date || new Date().toISOString().slice(0, 10),
      supplier_name: intent.supplier_name || null,
      description: 'Compra registrada desde el asistente',
      items: [{ product_id: intent.product_id, quantity: intent.quantity, unit_price: unitPrice }],
    }
    const { data, error } = await auth.supabase.rpc('confirm_purchase', { p_purchase: purchase, p_idempotency_key: intent.idempotency_key })
    if (error) return apiError(res, error)
    return res.status(200).json({ intent: intent.intent, purchase: data, result: `Compra confirmada por ${data.total} ARS.` })
  }
  const movementType = intent.intent === 'set_stock' ? 'set_stock' : ['consume_stock', 'decrease_stock'].includes(intent.intent) ? 'consume' : 'increase'
  const { data, error } = await auth.supabase.rpc('record_stock_movement', {
    p_product_id: intent.product_id,
    p_movement_type: movementType,
    p_quantity: movementType === 'set_stock' ? null : intent.quantity,
    p_absolute_stock: movementType === 'set_stock' ? intent.quantity : null,
    p_reason: intent.intent === 'consume_stock' ? 'Consumo por asistente' : 'Operación confirmada por asistente',
    p_note: 'Confirmado por el usuario desde el asistente',
    p_idempotency_key: intent.idempotency_key,
  })
  if (error) return apiError(res, error)
  return res.status(200).json({ intent: intent.intent, movement: data, result: `Movimiento confirmado. Stock anterior: ${data.previous_stock}. Stock actual: ${data.resulting_stock}.` })
}
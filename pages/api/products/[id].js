import { z } from 'zod'
import { apiError, requireUser } from '../../../lib/supabase-server'
import { productUpdateSchema } from '../../../lib/validation'

const idSchema = z.string().uuid()

export default async function handler(req, res) {
  const parsedId = idSchema.safeParse(req.query.id)
  if (!parsedId.success) return res.status(400).json({ error: 'Identificador de producto inválido.' })
  if (!['PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  if (req.method === 'DELETE') {
    const { data, error } = await auth.supabase.rpc('update_product', { p_product_id: parsedId.data, p_product: {}, p_active: false })
    if (error) return apiError(res, error)
    return res.status(200).json({ product: data })
  }
  const parsed = productUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá los datos del producto.' })
  const { data, error } = await auth.supabase.rpc('update_product', { p_product_id: parsedId.data, p_product: parsed.data, p_active: true })
  if (error) return apiError(res, error)
  return res.status(200).json({ product: data })
}
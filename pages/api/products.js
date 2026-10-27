import { z } from 'zod'
import { apiError, requireUser } from '../../lib/supabase-server'
import { productSchema } from '../../lib/validation'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá los datos del producto.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.supabase.rpc('create_product', { p_product: parsed.data })
  if (error) return apiError(res, error)
  return res.status(201).json({ product: data })
}
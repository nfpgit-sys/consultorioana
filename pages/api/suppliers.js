import { z } from 'zod'
import { apiError, requireUser } from '../../lib/supabase-server'

const schema = z.object({ name: z.string().trim().min(1).max(120), tax_id: z.string().trim().max(20).optional(), phone: z.string().trim().max(40).optional(), email: z.string().trim().email().max(160).or(z.literal('')).optional(), address: z.string().trim().max(180).optional(), notes: z.string().trim().max(500).optional() })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá los datos del proveedor.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.supabase.rpc('create_supplier', { p_supplier: parsed.data })
  if (error) return apiError(res, error)
  return res.status(201).json({ supplier: data })
}
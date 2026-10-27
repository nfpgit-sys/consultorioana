import { expenseSchema } from '../../lib/validation'
import { apiError, requireUser } from '../../lib/supabase-server'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = expenseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisá la fecha, la descripción y el importe.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.supabase.rpc('create_manual_expense', { p_expense: parsed.data })
  if (error) return apiError(res, error)
  return res.status(201).json({ expense: data })
}
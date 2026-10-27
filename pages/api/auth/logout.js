import { requireUser } from '../../../lib/supabase-server'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { error } = await auth.supabase.auth.signOut()
  if (error) return res.status(400).json({ error: 'No se pudo cerrar la sesión.' })
  return res.status(200).json({ ok: true })
}
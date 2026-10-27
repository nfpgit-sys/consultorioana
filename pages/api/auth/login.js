import { createApiSupabase } from '../../../lib/supabase-server'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const supabase = createApiSupabase(req, res)
  if (!supabase) return res.status(503).json({ error: 'Supabase no está configurado.' })
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!email || !password || password.length > 256) return res.status(400).json({ error: 'Revisá el correo y la contraseña.' })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return res.status(401).json({ error: 'No se pudo iniciar sesión. Revisá tus credenciales.' })
  return res.status(200).json({ ok: true })
}
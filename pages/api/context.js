import { apiError, requireUser } from '../../lib/supabase-server'

export default async function handler(req, res) {
  const demoEnabled = process.env.DEMO_MODE_ENABLED === 'true' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return res.status(200).json({ configured: false, user: null, clinic: null, demoEnabled })
  }
  const auth = await requireUser(req, res)
  if (auth.error) {
    if (auth.status === 401) return res.status(200).json({ configured: true, user: null, clinic: null, demoEnabled })
    return res.status(auth.status).json({ error: auth.error })
  }
  const { supabase, user } = auth

  if (req.method === 'POST') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Ingresá un nombre de consultorio válido.' })
    const { data, error } = await supabase.rpc('bootstrap_clinic', { p_name: name })
    if (error) return apiError(res, error)
    return res.status(201).json({ clinic: data })
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })

  const { data: membership, error } = await supabase
    .from('clinic_members')
    .select('clinic_id, role, clinics(id, name, currency, timezone)')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .order('clinic_id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return apiError(res, error)
  return res.status(200).json({
    configured: true,
    user: { id: user.id, email: user.email },
    clinic: membership?.clinics || null,
    role: membership?.role || null,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    demoEnabled,
  })
}
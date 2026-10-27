import { createServerClient } from '@supabase/ssr'

export function createApiSupabase(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        const headers = cookies.map(({ name, value, options }) => {
          const parts = [`${name}=${encodeURIComponent(value)}`]
          if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`)
          if (options.path) parts.push(`Path=${options.path}`)
          if (options.httpOnly) parts.push('HttpOnly')
          if (options.secure) parts.push('Secure')
          if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
          return parts.join('; ')
        })
        res.setHeader('Set-Cookie', headers)
      },
    },
  })
}

export async function requireUser(req, res) {
  const supabase = createApiSupabase(req, res)
  if (!supabase) return { error: 'Supabase no está configurado.', status: 503 }
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Iniciá sesión para continuar.', status: 401 }
  return { supabase, user }
}

export function apiError(res, error) {
  const message = error?.message || 'No se pudo completar la operación.'
  const status = /insufficient|negative|permission|authorized|member|stock|not found|duplicate|already/i.test(message) ? 409 : 400
  return res.status(status).json({ error: message })
}
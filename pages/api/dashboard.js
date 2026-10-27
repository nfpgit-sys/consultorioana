import { requireUser } from '../../lib/supabase-server'

function clinicToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { supabase, user } = auth
  const { data: membership, error: memberError } = await supabase.from('clinic_members').select('clinic_id').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle()
  if (memberError) return res.status(400).json({ error: 'No se pudo validar el consultorio.' })
  if (!membership) return res.status(403).json({ error: 'Tu cuenta no tiene acceso a un consultorio.' })

  const today = clinicToday()
  const monthStart = `${today.slice(0, 7)}-01`
  const [products, movements, expenses, suppliers] = await Promise.all([
    supabase.from('products').select('id, name, category, brand, base_unit, current_stock, minimum_stock, reference_cost, active').eq('clinic_id', membership.clinic_id).eq('active', true).order('name'),
    supabase.from('stock_movements').select('id, product_id, movement_type, direction, quantity, previous_stock, resulting_stock, reason, created_at, products(name, base_unit)').eq('clinic_id', membership.clinic_id).order('created_at', { ascending: false }).limit(100),
    supabase.from('expenses').select('id, description, category, amount, currency, expense_date, supplier_name, purchase_id').eq('clinic_id', membership.clinic_id).gte('expense_date', monthStart).lte('expense_date', today).eq('status', 'confirmed').order('expense_date', { ascending: false }),
    supabase.from('suppliers').select('id, name, tax_id, phone, email').eq('clinic_id', membership.clinic_id).order('name'),
  ])
  for (const result of [products, movements, expenses, suppliers]) if (result.error) return res.status(400).json({ error: 'No se pudieron cargar los datos del consultorio.' })
  const movementRows = (movements.data || []).map((row) => ({ ...row, product_name: row.products?.name || 'Producto archivado', base_unit: row.products?.base_unit || '', products: undefined }))
  return res.status(200).json({ products: products.data || [], movements: movementRows, expenses: expenses.data || [], suppliers: suppliers.data || [] })
}
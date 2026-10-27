import OpenAI from 'openai'
import { z } from 'zod'
import { intentJsonSchema, intentSchema } from '../../../lib/assistant-intents'
import { formatARS, sumDecimalCents } from '../../../lib/money'
import { requireUser } from '../../../lib/supabase-server'

const requestSchema = z.object({ text: z.string().trim().min(2).max(2000) })

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' })
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Escribí una instrucción de hasta 2.000 caracteres.' })
  const auth = await requireUser(req, res)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'La interpretación IA real no está configurada. Podés usar los formularios manuales.' })

  const { data: membership, error: memberError } = await auth.supabase.from('clinic_members').select('clinic_id').eq('user_id', auth.user.id).eq('active', true).order('created_at').limit(1).maybeSingle()
  if (memberError || !membership) return res.status(403).json({ error: 'No tenés acceso a un consultorio activo.' })
  const { data: products, error: productError } = await auth.supabase.from('products').select('id, name, brand, base_unit, current_stock, minimum_stock').eq('clinic_id', membership.clinic_id).eq('active', true)
  if (productError) return res.status(400).json({ error: 'No se pudo consultar el catálogo autorizado.' })

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 1 })
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: `Interpretá la solicitud en español como una sola intención del catálogo autorizado. Nunca inventes datos. Productos: ${JSON.stringify((products || []).map(({ name, brand, base_unit }) => ({ name, brand, base_unit })))}. Si hay varios productos similares, devolvé unknown y una aclaración. Si faltan campos, devolvé una aclaración. En compras, total_amount_ars solo se informa cuando está claramente expresado como importe total; si puede ser precio unitario, pedí aclaración. set_stock es cantidad absoluta. No generes consultas ni instrucciones SQL.`,
      input: parsed.data.text,
      text: { format: { type: 'json_schema', name: 'inventory_intent', strict: true, schema: intentJsonSchema() } },
    })
    const raw = intentSchema.safeParse(JSON.parse(response.output_text || '{}'))
    if (!raw.success) return res.status(502).json({ error: 'El proveedor devolvió una interpretación incompleta. No se realizó ningún cambio.' })
    const intent = raw.data
    const candidates = intent.product_name ? (products || []).filter((product) => product.name.toLocaleLowerCase('es-AR') === intent.product_name.toLocaleLowerCase('es-AR')) : []
    const product = candidates.length === 1 ? candidates[0] : null
    let clarification = intent.clarification
    if (intent.product_name && candidates.length === 0) clarification = 'No se identificó un producto exacto del catálogo. Elegí el producto correcto antes de continuar.'
    if (intent.product_name && candidates.length > 1) clarification = 'Hay más de un producto con ese nombre. Seleccioná uno.'
    if (['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock'].includes(intent.intent) && !product) clarification ||= 'Seleccioná un producto del catálogo.'
    if (intent.intent === 'purchase_stock' && intent.total_amount_ars == null && intent.unit_price_ars == null) clarification ||= 'Indicá el importe total o el precio unitario de la compra.'
    if (clarification) return res.status(200).json({ intent, clarification, options: candidates, requires_confirmation: false })

    if (intent.intent === 'query_stock') {
      const result = product ? `${product.name}: ${product.current_stock} ${product.base_unit} disponibles.` : (products || []).filter((item) => Number(item.current_stock) === 0).map((item) => item.name).join(', ') || 'No hay productos agotados.'
      return res.status(200).json({ intent, product, result, requires_confirmation: false })
    }
    if (intent.intent === 'query_expenses') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const { data: expenses, error } = await auth.supabase.from('expenses').select('amount').eq('clinic_id', membership.clinic_id).eq('status', 'confirmed').gte('expense_date', `${today.slice(0, 7)}-01`).lte('expense_date', today)
      if (error) return res.status(400).json({ error: 'No se pudo consultar el total del mes.' })
      return res.status(200).json({ intent, result: `Gastos registrados este mes: ${formatARS(sumDecimalCents((expenses || []).map((item) => item.amount)))}`, requires_confirmation: false })
    }
    return res.status(200).json({ intent, product, result: null, requires_confirmation: ['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock'].includes(intent.intent) })
  } catch (error) {
    if (error?.name === 'APIConnectionTimeoutError' || error?.name === 'APIConnectionError') return res.status(504).json({ error: 'El servicio de IA no respondió a tiempo. No se realizó ningún cambio.' })
    return res.status(502).json({ error: 'No se pudo interpretar la instrucción. No se realizó ningún cambio.' })
  }
}
import { z } from 'zod'

export const intentSchema = z.object({
  intent: z.enum(['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock', 'query_stock', 'query_expenses', 'unknown']),
  product_name: z.string().max(120).nullable(),
  quantity: z.number().positive().max(100000000).nullable(),
  unit: z.string().max(40).nullable(),
  total_amount_ars: z.number().nonnegative().max(100000000000).nullable(),
  unit_price_ars: z.number().nonnegative().max(100000000000).nullable(),
  clarification: z.string().max(240).nullable(),
})

const numberWords = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, quinientos: 500,
}

function normalized(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9.,$ ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseNumber(phrase) {
  if (!phrase) return null
  const numeric = phrase.match(/\d+(?:[.,]\d+)?/)
  if (numeric) return Number(numeric[0].replace(',', '.'))
  let total = 0
  let group = 0
  for (const word of phrase.split(' ')) {
    if (word === 'mil') { total += (group || 1) * 1000; group = 0 }
    else if (numberWords[word] !== undefined) group += numberWords[word]
  }
  return total + group || null
}

function captureNumberBefore(text, words) {
  const token = '(\\d+(?:[.,]\\d+)?|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|doscientos|trescientos|quinientos)'
  const regex = new RegExp(`\\b${token}\\s+(?:${words})\\b`)
  const match = text.match(regex)
  return match ? parseNumber(match[1]) : null
}

function matchProduct(text, products) {
  const matches = products.filter((product) => {
    const name = normalized(product.name).replace(/s\b/g, '')
    const query = text.replace(/s\b/g, '')
    return query.includes(name) || name.split(' ').filter((word) => word.length > 4).some((word) => query.includes(word))
  })
  return matches
}

export function parseDemoIntent(input, products = []) {
  const text = normalized(input)
  const matched = matchProduct(text, products)
  const product = matched.length === 1 ? matched[0] : null
  const productName = product?.name || null
  let intent = 'unknown'
  if (/(cuanto|cuantos|cuantas|stock|agotados|queda|quedan|inventario)/.test(text)) intent = 'query_stock'
  if (/(gastos|gastamos|gaste este mes|gaste hoy)/.test(text)) intent = 'query_expenses'
  if (/(compre|compra|comprar)/.test(text)) intent = 'purchase_stock'
  else if (/(stock real|stock ahora|cantidad real|ahora es de)/.test(text)) intent = 'set_stock'
  else if (/(desconta|descontar|quita|quitar|reduci|reducir|retira|retirar)/.test(text)) intent = 'decrease_stock'
  else if (/(gaste|use|utilice|consumi|consumir)/.test(text)) intent = 'consume_stock'
  else if (/(agrega|agregar|suma|sumar|aumenta|aumentar|ingresa|ingresar)/.test(text)) intent = 'increase_stock'

  const quantity = captureNumberBefore(text, 'unidades?|jeringas?|tubos?|frascos?|cajas?|paquetes?|gramos?|g|mililitros?|ml|litros?|l|carpules?')
    ?? captureNumberBefore(text, 'de')
    ?? parseNumber(text.match(/\b(?:es|ahora es|queda|quedan)\s+de\s+(\d+(?:[.,]\d+)?|cero|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|doscientos|trescientos|quinientos)\b/)?.[1])
  const unitMatch = text.match(/\b(unidades?|jeringas?|tubos?|frascos?|cajas?|paquetes?|gramos?|g|mililitros?|ml|litros?|l|carpules?)\b/)
  const amountMatch = text.match(/(?:por|total(?:\s+de)?|importe(?:\s+de)?)\s+([\d.,]+|(?:\w+\s+)?mil\b)/)
  const totalAmount = amountMatch ? parseNumber(amountMatch[1]) : null
  const hasPurchasePrice = intent === 'purchase_stock' && totalAmount !== null
  let clarification = null

  if (matched.length > 1) clarification = `Hay varios productos que podrían coincidir: ${matched.map((item) => item.name).join(', ')}. Elegí uno.`
  else if (['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock'].includes(intent) && !product) clarification = 'No pude identificar un único producto del catálogo. Elegí un producto antes de continuar.'
  else if (['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock'].includes(intent) && quantity === null) clarification = 'Indicá qué cantidad querés registrar.'
  else if (intent === 'purchase_stock' && !hasPurchasePrice) clarification = 'Indicá el importe total de la compra en pesos antes de continuar.'
  else if (intent === 'purchase_stock' && /por\s+unidad|cada\s+uno|unitario/.test(text)) clarification = '¿El importe indicado es el total de la compra o el precio por unidad?'
  else if (intent === 'set_stock' && quantity === null) clarification = 'Indicá cuál es la cantidad real verificada.'

  return intentSchema.parse({
    intent,
    product_name: productName,
    quantity,
    unit: unitMatch?.[1] || null,
    total_amount_ars: hasPurchasePrice ? totalAmount : null,
    unit_price_ars: null,
    clarification,
  })
}

export function intentJsonSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['consume_stock', 'purchase_stock', 'increase_stock', 'decrease_stock', 'set_stock', 'query_stock', 'query_expenses', 'unknown'] },
      product_name: { type: ['string', 'null'] },
      quantity: { type: ['number', 'null'] },
      unit: { type: ['string', 'null'] },
      total_amount_ars: { type: ['number', 'null'] },
      unit_price_ars: { type: ['number', 'null'] },
      clarification: { type: ['string', 'null'] },
    },
    required: ['intent', 'product_name', 'quantity', 'unit', 'total_amount_ars', 'unit_price_ars', 'clarification'],
  }
}
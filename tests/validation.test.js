import { describe, expect, it } from 'vitest'
import { expenseSchema, movementSchema, productSchema, purchaseSchema } from '../lib/validation'
import { formatARS, sumDecimalCents } from '../lib/money'
import { parseDemoIntent } from '../lib/assistant-intents'

const productId = 'c0a80101-0000-4000-8000-000000000001'

describe('validación de inventario', () => {
  it('acepta stock inicial decimal y unidad base explícita', () => {
    expect(productSchema.safeParse({ name: 'Material', base_unit: 'g', initial_stock: 1.25, minimum_stock: 0.5 }).success).toBe(true)
  })

  it('rechaza cantidades negativas y unidades desconocidas', () => {
    expect(productSchema.safeParse({ name: 'Material', base_unit: 'caja', initial_stock: -1 }).success).toBe(false)
    expect(productSchema.safeParse({ name: 'Material', base_unit: 'litros' }).success).toBe(false)
  })

  it('valida consumos positivos y correcciones absolutas', () => {
    expect(movementSchema.safeParse({ product_id: productId, movement_type: 'consume', quantity: 0.25, reason: 'consumption' }).success).toBe(true)
    expect(movementSchema.safeParse({ product_id: productId, movement_type: 'set_stock', absolute_stock: 0, reason: 'adjustment' }).success).toBe(true)
    expect(movementSchema.safeParse({ product_id: productId, movement_type: 'consume', quantity: 0, reason: 'consumption' }).success).toBe(false)
  })
})

describe('compras y gastos', () => {
  it('requiere línea de compra con producto, cantidad y precio', () => {
    const purchase = { purchase_date: '2026-10-26', description: 'Materiales', items: [{ product_id: productId, quantity: 2, unit_price: 1500 }] }
    expect(purchaseSchema.safeParse(purchase).success).toBe(true)
    expect(purchaseSchema.safeParse({ ...purchase, items: [] }).success).toBe(false)
  })

  it('acepta gastos manuales independientes del inventario', () => {
    expect(expenseSchema.safeParse({ description: 'Servicio', category: 'Servicios', amount: 1250.5, expense_date: '2026-10-26' }).success).toBe(true)
    expect(expenseSchema.safeParse({ description: 'Servicio', category: 'Servicios', amount: -1, expense_date: '2026-10-26' }).success).toBe(false)
  })
})

describe('aritmética monetaria', () => {
  it('suma importes decimales sin aproximación binaria', () => {
    expect(sumDecimalCents(['0.10', '0.20', '1500.99'])).toBe(150129n)
    expect(formatARS(sumDecimalCents(['0.10', '0.20']))).toBe('$ 0,30')
  })
})

describe('intenciones del asistente demo', () => {
  const products = [
    { id: 'one', name: 'Jeringa descartable', base_unit: 'unidad' },
    { id: 'two', name: 'Pasta profiláctica', base_unit: 'tubo' },
  ]

  it('distingue consumo, compra y stock absoluto', () => {
    expect(parseDemoIntent('Hoy gasté tres jeringas', products)).toMatchObject({ intent: 'consume_stock', quantity: 3, product_name: 'Jeringa descartable' })
    expect(parseDemoIntent('Compré cinco tubos de pasta por ocho mil pesos', products)).toMatchObject({ intent: 'purchase_stock', quantity: 5, total_amount_ars: 8000, product_name: 'Pasta profiláctica' })
    expect(parseDemoIntent('el stock real de jeringas ahora es de ocho', products)).toMatchObject({ intent: 'set_stock', quantity: 8 })
  })

  it('pide aclaración cuando producto o importe faltan', () => {
    expect(parseDemoIntent('Descontá dos frascos de adhesivo', products).clarification).toMatch(/identificar/)
    expect(parseDemoIntent('Compré cinco tubos de pasta', products).clarification).toMatch(/importe total/)
  })
})
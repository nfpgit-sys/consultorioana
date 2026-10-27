import { describe, expect, it } from 'vitest'
import { DemoRepository, demoStorageKey } from '../lib/demo-repository'

function createStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('repositorio de demostración aislado', () => {
  it('persiste stock inicial y movimientos de consumo', () => {
    const repository = new DemoRepository(createStorage())
    const product = repository.createProduct({ name: 'Guantes de nitrilo', base_unit: 'unidad', initial_stock: 12, minimum_stock: 2 }).product
    expect(repository.snapshot().movements[0].resulting_stock).toBe('12')
    repository.recordMovement({ product_id: product.id, movement_type: 'consume', quantity: 3, reason: 'consumption' })
    expect(repository.snapshot().products.find((item) => item.id === product.id).current_stock).toBe('9')
  })

  it('rechaza una salida que dejaría stock negativo', () => {
    const repository = new DemoRepository(createStorage())
    const product = repository.createProduct({ name: 'Material', base_unit: 'g', initial_stock: 1 }).product
    expect(() => repository.recordMovement({ product_id: product.id, movement_type: 'consume', quantity: 2, reason: 'consumption' })).toThrow(/Stock insuficiente/)
  })

  it('confirma una compra una sola vez y genera gasto más entrada', () => {
    const repository = new DemoRepository(createStorage())
    const product = repository.createProduct({ name: 'Tubo demo', base_unit: 'tubo' }).product
    const purchase = { idempotency_key: 'one-request', purchase_date: '2026-10-27', description: 'Reposición', items: [{ product_id: product.id, quantity: 3, unit_price: '8000.00' }] }
    const first = repository.confirmPurchase(purchase)
    const retry = repository.confirmPurchase(purchase)
    expect(first.purchase.total).toBe('24000.00')
    expect(retry.duplicate).toBe(true)
    expect(repository.snapshot().purchases).toHaveLength(1)
    expect(repository.snapshot().expenses.filter((expense) => expense.purchase_id)).toHaveLength(1)
    expect(repository.snapshot().products.find((item) => item.id === product.id).current_stock).toBe('3')
  })

  it('mantiene gastos manuales separados y archiva sin borrar historial', () => {
    const storage = createStorage()
    const repository = new DemoRepository(storage)
    const product = repository.createProduct({ name: 'Material', base_unit: 'unidad', initial_stock: 2 }).product
    repository.createExpense({ description: 'Servicio', category: 'Servicios', amount: '100.00', expense_date: '2026-10-27' })
    repository.updateProduct(product.id, {}, false)
    const restored = new DemoRepository(storage).snapshot()
    expect(restored.products.find((item) => item.id === product.id).active).toBe(false)
    expect(restored.movements.filter((movement) => movement.product_id === product.id)).toHaveLength(1)
    expect(restored.expenses.at(-1).purchase_id).toBeNull()
    expect(demoStorageKey).toContain('demo')
  })
})
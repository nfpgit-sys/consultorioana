import { sumDecimalCents } from './money'

const STORAGE_KEY = 'clinica-clara-demo-v1'
const today = () => new Date().toISOString().slice(0, 10)
const makeId = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`
const timestamp = () => new Date().toISOString()

function seeds() {
  const products = [
    { id: 'demo-jeringas', name: 'Jeringa descartable', category: 'Descartables', brand: 'DentalPro', base_unit: 'unidad', current_stock: 0, minimum_stock: 20, reference_cost: '120.00', active: true },
    { id: 'demo-resina', name: 'Resina compuesta', category: 'Operatoria', brand: 'Ceramix', base_unit: 'jeringa', current_stock: 8, minimum_stock: 3, reference_cost: '8400.00', active: true },
    { id: 'demo-pasta', name: 'Pasta profiláctica', category: 'Profilaxis', brand: 'CleanDent', base_unit: 'tubo', current_stock: 4, minimum_stock: 2, reference_cost: '2100.00', active: true },
    { id: 'demo-anestesia', name: 'Anestesia local', category: 'Anestesia', brand: 'Anestec', base_unit: 'carpule', current_stock: 18, minimum_stock: 10, reference_cost: '950.00', active: true },
    { id: 'demo-adhesivo', name: 'Adhesivo dentinario', category: 'Operatoria', brand: 'Bondix', base_unit: 'frasco', current_stock: 2, minimum_stock: 3, reference_cost: null, active: true },
  ]
  const now = timestamp()
  return {
    products,
    movements: [{ id: makeId(), product_id: products[1].id, product_name: products[1].name, movement_type: 'initial', direction: 'in', quantity: '8', previous_stock: '0', resulting_stock: '8', base_unit: products[1].base_unit, reason: 'Stock inicial demo', created_at: now }],
    purchases: [],
    expenses: [{ id: makeId(), description: 'Servicio de internet', category: 'Servicios', amount: '18500.00', currency: 'ARS', expense_date: today(), supplier_name: 'Conectividad Sur', purchase_id: null }],
    suppliers: [{ id: 'demo-proveedor-1', name: 'Depósito Odontológico Sur', tax_id: null, phone: '11 4000 2200', email: 'ventas@example.test' }],
    idempotencyKeys: [],
  }
}

function normalizeState(state) {
  return state && Array.isArray(state.products) && Array.isArray(state.movements) ? state : seeds()
}

export class DemoRepository {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage
    this.state = normalizeState(this.read())
  }

  read() {
    try { return JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null') } catch { return null }
  }

  persist() {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state))
    return this.snapshot()
  }

  snapshot() {
    return structuredClone(this.state)
  }

  reset() {
    this.state = seeds()
    return this.persist()
  }

  createProduct(input) {
    if (this.state.products.some((product) => product.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new Error('Ya existe un producto con ese nombre.')
    const stock = Number(input.initial_stock || 0)
    if (!Number.isFinite(stock) || stock < 0) throw new Error('El stock inicial no puede ser negativo.')
    const product = { ...input, id: makeId(), current_stock: String(stock), minimum_stock: String(input.minimum_stock || 0), active: true }
    this.state.products.push(product)
    if (stock > 0) this.addMovement(product, 'initial', 'in', stock, 0, stock, 'Stock inicial', 'system')
    return { product: this.persist().products.find((item) => item.id === product.id) }
  }

  updateProduct(id, input, active = true) {
    const product = this.product(id)
    if (!active) product.active = false
    else {
      if (input.base_unit !== product.base_unit && (Number(product.current_stock) !== 0 || this.state.movements.some((movement) => movement.product_id === id))) throw new Error('No se puede cambiar la unidad base de un producto con historial.')
      Object.assign(product, input)
    }
    this.persist()
    return { product }
  }

  recordMovement(input) {
    const product = this.product(input.product_id)
    const before = Number(product.current_stock)
    const after = input.movement_type === 'set_stock' ? Number(input.absolute_stock) : before + (input.movement_type === 'consume' ? -Number(input.quantity) : Number(input.quantity))
    if (!Number.isFinite(after) || after < 0) throw new Error(`Stock insuficiente. Disponible: ${before} ${product.base_unit}.`)
    const delta = Math.abs(after - before)
    if (!delta) throw new Error('La cantidad ya coincide con el stock actual.')
    product.current_stock = String(after)
    const direction = input.movement_type === 'increase' ? 'in' : input.movement_type === 'consume' ? 'out' : 'adjustment'
    const movement = this.addMovement(product, input.movement_type, direction, delta, before, after, input.reason, 'manual', input.note)
    this.persist()
    return { movement, product }
  }

  confirmPurchase(input) {
    const key = input.idempotency_key
    const existing = key && this.state.purchases.find((purchase) => purchase.idempotency_key === key)
    if (existing) return { purchase: existing, duplicate: true }
    if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('La compra debe tener al menos un producto.')
    const lines = input.items.map((item) => {
      const product = this.product(item.product_id)
      const quantity = Number(item.quantity)
      const unitPrice = String(item.unit_price)
      if (!Number.isFinite(quantity) || quantity <= 0 || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(unitPrice)) throw new Error('Cantidad o precio inválido.')
      return { product, quantity, unit_price: unitPrice, line_total: String(Number(unitPrice) * quantity) }
    })
    const totalCents = lines.reduce((sum, line) => sum + sumDecimalCents([line.line_total]), 0n)
    const total = `${totalCents / 100n}.${String(totalCents % 100n).padStart(2, '0')}`
    const purchase = { id: makeId(), ...input, items: lines.map(({ product, quantity, ...line }) => ({ product_id: product.id, quantity: String(quantity), purchase_unit: product.base_unit, ...line })), total, currency: 'ARS', status: 'confirmed', created_at: timestamp() }
    for (const line of lines) {
      const before = Number(line.product.current_stock)
      line.product.current_stock = String(before + line.quantity)
      this.addMovement(line.product, 'purchase', 'in', line.quantity, before, before + line.quantity, 'Compra', 'manual', null, purchase.id)
    }
    this.state.purchases.push(purchase)
    this.state.expenses.push({ id: makeId(), description: input.description, category: 'Materiales', amount: total, currency: 'ARS', expense_date: input.purchase_date, supplier_name: input.supplier_name || null, purchase_id: purchase.id })
    if (key) this.state.idempotencyKeys.push(key)
    this.persist()
    return { purchase }
  }

  createExpense(input) {
    const expense = { ...input, id: makeId(), amount: String(input.amount), currency: 'ARS', supplier_name: input.supplier_name || null, purchase_id: null, status: 'confirmed' }
    this.state.expenses.push(expense)
    this.persist()
    return { expense }
  }

  createSupplier(input) {
    const supplier = { ...input, id: makeId() }
    this.state.suppliers.push(supplier)
    this.persist()
    return { supplier }
  }

  product(id) {
    const product = this.state.products.find((item) => item.id === id && item.active)
    if (!product) throw new Error('Producto no encontrado.')
    return product
  }

  addMovement(product, movementType, direction, amount, before, after, reason, origin, note = null, purchaseId = null) {
    const movement = { id: makeId(), product_id: product.id, product_name: product.name, movement_type: movementType, direction, quantity: String(amount), previous_stock: String(before), resulting_stock: String(after), base_unit: product.base_unit, reason, origin, note, purchase_id: purchaseId, created_at: timestamp() }
    this.state.movements.unshift(movement)
    return movement
  }
}

export const demoStorageKey = STORAGE_KEY
import { z } from 'zod'

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).optional().nullable(),
  brand: z.string().trim().max(80).optional().nullable(),
  base_unit: z.enum(['unidad', 'tubo', 'frasco', 'caja', 'paquete', 'g', 'mg', 'ml', 'l']),
  initial_stock: z.number().min(0).max(100000000).default(0),
  minimum_stock: z.number().min(0).max(100000000).default(0),
  reference_cost: z.number().min(0).max(100000000000).nullable().optional(),
  supplier_name: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
})

export const productUpdateSchema = productSchema.omit({ initial_stock: true })

export const movementSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
  product_id: z.string().uuid(),
  movement_type: z.enum(['consume', 'increase', 'set_stock']),
  quantity: z.number().positive().max(100000000).optional(),
  absolute_stock: z.number().min(0).max(100000000).optional(),
  reason: z.enum(['consumption', 'restock', 'return', 'adjustment', 'correction', 'damaged']),
  note: z.string().trim().max(240).optional().nullable(),
}).refine((value) => value.movement_type === 'set_stock' ? value.absolute_stock !== undefined : value.quantity !== undefined, 'La cantidad requerida no es válida.')

export const purchaseSchema = z.object({
  idempotency_key: z.string().uuid().optional(),
  supplier_name: z.string().trim().max(120).nullable().optional(),
  purchase_date: z.string().date(),
  description: z.string().trim().min(1).max(200),
  items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().positive().max(100000000), unit_price: z.number().min(0).max(100000000000) })).min(1).max(100),
})

export const expenseSchema = z.object({
  description: z.string().trim().min(1).max(180),
  category: z.string().trim().min(1).max(60),
  amount: z.number().positive().max(100000000000),
  expense_date: z.string().date(),
  supplier_name: z.string().trim().max(120).optional().nullable(),
})
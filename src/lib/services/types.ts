import type { BaseUnit } from "@/lib/domain/units";

export type StockStatus = "ok" | "bajo" | "agotado";

export interface Presentation {
  id: string;
  name: string;
  factor: number;
}

export interface Product {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  baseUnit: BaseUnit;
  currentStock: number;
  minStock: number;
  unitCost: number | null;
  tracksExpiry: boolean;
  barcode: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
  updatedAt: string;
  status: StockStatus;
  /** Valor estimado del stock (stock × costo unitario), si hay costo. */
  stockValue: number | null;
  presentations: Presentation[];
}

export interface Lot {
  id: string;
  productId: string;
  lotCode: string | null;
  expiresOn: string | null;
  quantity: number;
}

export type MovementKind = "stock_inicial" | "compra" | "ingreso" | "consumo" | "ajuste" | "reversion" | "vencimiento";

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  stock_inicial: "Stock inicial",
  compra: "Compra",
  ingreso: "Ingreso",
  consumo: "Consumo",
  ajuste: "Ajuste",
  reversion: "Reversión",
  vencimiento: "Baja por vencimiento",
};

export interface Movement {
  id: string;
  number: number;
  productId: string;
  productName: string;
  baseUnit: BaseUnit;
  lotId: string | null;
  lotCode: string | null;
  lotExpiresOn: string | null;
  kind: MovementKind;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  inputQuantity: number | null;
  inputUnit: string | null;
  unitCost: number | null;
  reason: string | null;
  source: string;
  purchaseId: string | null;
  purchaseNumber: number | null;
  reversesMovementId: string | null;
  reversesNumber: number | null;
  reversedByNumber: number | null;
  operationId: string;
  actor: string | null;
  effectiveDate: string;
  createdAt: string;
}

export interface Warning {
  code: string;
  message: string;
  /** Si es true, la operación solo se ejecuta con una confirmación explícita adicional. */
  requiresAck: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archivedAt: string | null;
}

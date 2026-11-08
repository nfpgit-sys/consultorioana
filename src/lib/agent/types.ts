import type { BaseUnit } from "@/lib/domain/units";
import type { StockStatus, Warning } from "@/lib/services/types";

/**
 * Propuestas del asistente: operaciones interpretadas y validadas por el servidor,
 * que NO se ejecutan hasta que la persona las confirma en la tarjeta.
 */
export interface MovementProposalInput {
  items: { productId: string; quantity: number; unit: string | null; kind: "consumo" | "ingreso"; reason: string | null }[];
  effectiveDate: string | null;
}

export interface PurchaseProposalInput {
  supplierName: string | null;
  purchaseDate: string;
  docNumber: string | null;
  items: { productId: string | null; description: string | null; quantity: number; unit: string | null; lineTotal: number | null; unitPrice: number | null }[];
  total: number | null;
}

export interface ExpenseProposalInput {
  expenseDate: string;
  category: string;
  description: string;
  amount: number;
  supplierName: string | null;
}

export interface ProductProposalInput {
  name: string;
  category: string | null;
  baseUnit: BaseUnit;
  initialStock: number;
  minStock: number;
  unitCost: number | null;
  tracksExpiry: boolean;
  presentations: { name: string; factor: number }[];
}

export interface AdjustProposalInput {
  productId: string;
  newStock: number;
  reason: string;
}

export interface ReversalProposalInput {
  movementId: string;
  reason: string;
}

export interface PresentationProposalInput {
  productId: string;
  name: string;
  factor: number;
}

interface ProposalBase {
  id: string;
  title: string;
  warnings: Warning[];
  /** Resumen en una línea (lo agrega el servidor para el historial de la conversación). */
  summary?: string;
}

export interface MovementPreviewLine {
  productId: string;
  productName: string;
  baseUnit: BaseUnit;
  kind: "consumo" | "ingreso";
  inputLabel: string;
  baseQuantity: number;
  stockBefore: number;
  stockAfter: number;
  statusAfter: StockStatus;
}

export type Proposal =
  | (ProposalBase & { type: "movimientos"; input: MovementProposalInput; lines: MovementPreviewLine[] })
  | (ProposalBase & {
      type: "compra";
      input: PurchaseProposalInput;
      lines: { label: string; productName: string | null; inputLabel: string; lineTotal: number | null; stockAfter: number | null }[];
      total: number | null;
      pendingPrice: boolean;
      supplierIsNew: boolean;
    })
  | (ProposalBase & { type: "gasto"; input: ExpenseProposalInput })
  | (ProposalBase & { type: "producto"; input: ProductProposalInput; similar: { id: string; name: string }[] })
  | (ProposalBase & {
      type: "ajuste";
      input: AdjustProposalInput;
      productName: string;
      baseUnit: BaseUnit;
      stockBefore: number;
      stockAfter: number;
    })
  | (ProposalBase & { type: "reversion"; input: ReversalProposalInput; description: string; stockBefore: number; stockAfter: number; baseUnit: BaseUnit })
  | (ProposalBase & { type: "presentacion"; input: PresentationProposalInput; productName: string; baseUnit: BaseUnit });

export type ProposalType = Proposal["type"];

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  reply: string;
  proposals: Proposal[];
  mode: "ia" | "basico";
  /** Aviso no bloqueante (por ejemplo, la IA no respondió y se usó el modo básico). */
  notice?: string;
}

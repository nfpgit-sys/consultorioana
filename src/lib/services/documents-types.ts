export const DOC_TYPES = [
  "factura_a",
  "factura_b",
  "factura_c",
  "factura_m",
  "ticket",
  "recibo",
  "remito",
  "nota_credito",
  "otro",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  factura_c: "Factura C",
  factura_m: "Factura M",
  ticket: "Ticket",
  recibo: "Recibo",
  remito: "Remito",
  nota_credito: "Nota de crédito",
  otro: "Otro comprobante",
};

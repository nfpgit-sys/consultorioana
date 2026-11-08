import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Facturas" };

export default function FacturasPage() {
  return <PageHeader title="Facturas" description="Carga inteligente de facturas (en construcción)." />;
}

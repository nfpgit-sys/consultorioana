import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceReview } from "@/components/invoices/invoice-review";
import { SystemErrorCard } from "@/components/system-error";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { getAiConfig } from "@/lib/config";
import { formatDateTime } from "@/lib/domain/format";
import { buildReview } from "@/lib/invoices/review";
import { loadData } from "@/lib/server/load";
import { getDocument } from "@/lib/services/documents";
import { listExpenseCategories } from "@/lib/services/expenses";
import { listCategories, listProducts, SUGGESTED_CATEGORIES } from "@/lib/services/products";
import { listSuppliers } from "@/lib/services/suppliers";

export const metadata: Metadata = { title: "Revisar factura" };

export default async function FacturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadData(async (db) => {
    const doc = await getDocument(db, id);
    if (!doc) return null;
    const [review, products, suppliers, categories, expenseCategories] = await Promise.all([
      doc.status === "analizado" ? buildReview(db, doc) : Promise.resolve(null),
      listProducts(db),
      listSuppliers(db),
      listCategories(db),
      listExpenseCategories(db),
    ]);
    return { doc, review, products, suppliers, categories, expenseCategories };
  });
  if (!loaded.ok) return <SystemErrorCard error={loaded.error} />;
  if (!loaded.data) notFound();
  const { doc, review, products, suppliers, categories, expenseCategories } = loaded.data;
  const ai = getAiConfig();
  const stored = doc.files.filter((f) => f.storage !== "none");

  return (
    <>
      <Link href="/facturas" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Facturas
      </Link>
      <PageHeader
        title={`Comprobante #${doc.number}`}
        description={`Subido ${formatDateTime(doc.createdAt)}${doc.actor ? ` por ${doc.actor}` : ""}${doc.extractionModel ? ` · leído con ${doc.extractionModel}` : ""}`}
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card className="lg:sticky lg:top-6">
            <CardHeader title="Original" description={stored.length ? undefined : "No se guardó copia del archivo."} />
            <div className="space-y-2 p-3">
              {stored.map((f) =>
                f.mimeType === "application/pdf" ? (
                  <div key={f.id} className="space-y-2">
                    <iframe src={`/api/facturas/${doc.id}/archivo/${f.id}`} title={f.fileName} className="hidden h-[70vh] w-full rounded-xl border border-line lg:block" />
                    <a href={`/api/facturas/${doc.id}/archivo/${f.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
                      <ExternalLink className="h-4 w-4" /> Abrir PDF
                    </a>
                  </div>
                ) : (
                  <a key={f.id} href={`/api/facturas/${doc.id}/archivo/${f.id}`} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/facturas/${doc.id}/archivo/${f.id}`} alt={f.fileName} className="max-h-[70vh] w-full rounded-xl border border-line object-contain" />
                  </a>
                ),
              )}
            </div>
          </Card>
        </div>
        <div className="lg:col-span-3">
          {doc.status === "registrado" ? (
            <Alert
              tone="success"
              title="Comprobante registrado"
              action={
                doc.linkedPurchaseId ? (
                  <ButtonLink href={`/compras/${doc.linkedPurchaseId}`} size="sm" variant="outline">
                    Ver compra
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/gastos" size="sm" variant="outline">
                    Ver gastos
                  </ButtonLink>
                )
              }
            >
              Ya se registró. Para corregirlo, anulá la compra o el gasto y volvé a cargarlo.
            </Alert>
          ) : doc.status === "descartado" ? (
            <Alert tone="info" title="Comprobante descartado">
              {doc.discardedReason}
            </Alert>
          ) : (
            <>
              {doc.status === "error" && (
                <Alert tone="warning" className="mb-4" title="No se pudo leer automáticamente">
                  {doc.extractionError}
                </Alert>
              )}
              <InvoiceReview
                documentId={doc.id}
                review={review}
                products={products}
                suppliers={suppliers}
                categories={[...new Set([...categories, ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b, "es"))}
                expenseCategories={expenseCategories}
                canRetry={stored.length === doc.files.length && doc.files.length > 0}
                aiEnabled={ai.enabled}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Logo } from "@/components/logo";
import { Alert } from "@/components/ui/alert";
import { ACTOR_COOKIE } from "@/lib/auth/session";
import { getAuthConfig } from "@/lib/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };
export const dynamic = "force-dynamic";

export default async function IngresarPage({ searchParams }: { searchParams: Promise<{ siguiente?: string }> }) {
  const { siguiente } = await searchParams;
  const cfg = getAuthConfig();
  const store = await cookies();
  let defaultName = "";
  try {
    defaultName = decodeURIComponent(store.get(ACTOR_COOKIE)?.value ?? "");
  } catch {
    defaultName = "";
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top,_var(--color-brand-100),_transparent_60%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <p className="mt-3 text-sm text-muted">Inventario, compras y gastos del consultorio</p>
        </div>
        <div className="rounded-3xl border border-line bg-white p-6 shadow-[var(--shadow-float)]">
          {cfg.mode === "sin-configurar" ? (
            <Alert tone="warning" title="Acceso no configurado">
              Por seguridad, la aplicación publicada requiere una clave de acceso. Falta definir la variable{" "}
              <code className="rounded bg-amber-100 px-1">CLAVE_CONSULTORIO</code> en el servidor.
            </Alert>
          ) : (
            <>
              {cfg.mode === "abierto-local" && (
                <Alert tone="info" className="mb-4">
                  Modo desarrollo local: no hay clave configurada. En la versión publicada se pide la clave del consultorio.
                </Alert>
              )}
              <LoginForm next={siguiente ?? "/"} needsClave={cfg.mode === "clave"} defaultName={defaultName} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

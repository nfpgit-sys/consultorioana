import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-xl font-semibold">No encontramos esa página</h1>
      <p className="text-muted">Puede que el registro no exista o que el enlace esté incompleto.</p>
      <Link href="/" className="font-medium text-brand-700 hover:underline">
        Volver al inicio
      </Link>
    </main>
  );
}

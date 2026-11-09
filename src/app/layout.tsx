import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "consultorIA", template: "%s · consultorIA" },
  description: "Inventario, consumos, compras y gastos del consultorio odontológico, con asistente de IA.",
  applicationName: "consultorIA",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d7d73",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Todas las páginas se generan en cada pedido: así Next.js puede aplicar el nonce de la
  // política de seguridad de contenido (CSP) que arma src/proxy.ts.
  await connection();
  return (
    <html lang="es-AR">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

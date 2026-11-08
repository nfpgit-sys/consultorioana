"use client";

import { LogOut, Menu, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-context";
import { Logo } from "@/components/logo";
import { cn } from "@/components/ui/cn";
import { Toaster } from "@/components/ui/toast";
import { salir } from "@/app/ingresar/actions";
import { isActive, MOBILE_PRIMARY, NAV_ITEMS } from "./nav-items";

export interface ShellInfo {
  actor: string | null;
  openAccess: boolean;
  aiEnabled: boolean;
  voiceHint: string | null;
}

export function AppShell({ children, info }: { children: ReactNode; info: ShellInfo }) {
  return (
    <AssistantProvider aiEnabled={info.aiEnabled}>
      <ShellInner info={info}>{children}</ShellInner>
    </AssistantProvider>
  );
}

function ShellInner({ children, info }: { children: ReactNode; info: ShellInfo }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const assistant = useAssistant();

  useEffect(() => setMoreOpen(false), [pathname]);

  const primary = NAV_ITEMS.filter((i) => MOBILE_PRIMARY.includes(i.href));
  const secondary = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY.includes(i.href));

  return (
    <div className="min-h-dvh lg:flex">
      {/* Barra lateral (computadora) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="px-5 pt-5 pb-4">
          <Link href="/" aria-label="Inicio">
            <Logo />
          </Link>
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={() => assistant.setOpen(true)}
            className="mb-3 flex w-full items-center gap-2.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-left font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <Sparkles className="h-5 w-5" aria-hidden />
            Asistente
            <kbd className="ml-auto rounded-md bg-white/15 px-1.5 py-0.5 text-[0.7rem] font-medium">Ctrl K</kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Principal">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.95rem] transition-colors",
                  active ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <item.icon className={cn("h-5 w-5", active ? "text-brand-700" : "text-slate-500")} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-4 py-3 text-sm">
          <p className="truncate text-muted">{info.actor ? `Usando como ${info.actor}` : "Dispositivo del consultorio"}</p>
          {!info.openAccess && (
            <form action={salir}>
              <button type="submit" className="mt-1 inline-flex items-center gap-1.5 text-slate-600 hover:text-ink">
                <LogOut className="h-4 w-4" aria-hidden /> Cerrar sesión en este dispositivo
              </button>
            </form>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Encabezado (celular) */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
          <Link href="/" aria-label="Inicio">
            <Logo />
          </Link>
          <button
            type="button"
            onClick={() => assistant.setOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-50 px-3 text-sm font-medium text-brand-800"
          >
            <Sparkles className="h-4 w-4" aria-hidden /> Asistente
          </button>
        </header>

        {info.openAccess && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
            Modo desarrollo local sin clave de acceso. La versión publicada siempre pide la clave del consultorio.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">{children}</main>
      </div>

      {/* Navegación inferior (celular) */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:hidden"
        aria-label="Principal"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {primary.slice(0, 2).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => assistant.setOpen(true)}
              aria-label="Abrir asistente"
              className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-[var(--shadow-float)] ring-4 ring-white active:bg-brand-700"
            >
              <Sparkles className="h-6 w-6" aria-hidden />
            </button>
          </div>
          {primary.slice(2).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-0.5 text-[0.7rem] font-medium",
              secondary.some((i) => isActive(pathname, i.href)) ? "text-brand-700" : "text-slate-500",
            )}
          >
            <Menu className="h-6 w-6" aria-hidden />
            Más
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Más secciones">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Cerrar" onClick={() => setMoreOpen(false)} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 shadow-[var(--shadow-float)]">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="font-semibold">Más secciones</p>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-xl p-2 text-muted" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {secondary.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3.5 text-sm",
                    isActive(pathname, item.href) ? "border-brand-200 bg-brand-50 text-brand-800" : "border-line text-slate-700",
                  )}
                >
                  <item.icon className="h-6 w-6" aria-hidden />
                  {item.label}
                </Link>
              ))}
            </div>
            {!info.openAccess && (
              <form action={salir} className="mt-3">
                <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm text-slate-600">
                  <LogOut className="h-4 w-4" aria-hidden /> Cerrar sesión en este dispositivo
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <AssistantPanel voiceHint={info.voiceHint} />
      <Toaster />
    </div>
  );
}

function BottomLink({ item, active }: { item: (typeof NAV_ITEMS)[number]; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-col items-center gap-0.5 text-[0.7rem] font-medium", active ? "text-brand-700" : "text-slate-500")}
    >
      <item.icon className="h-6 w-6" aria-hidden />
      {item.label}
    </Link>
  );
}

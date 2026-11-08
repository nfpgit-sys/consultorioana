import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getActorName, isAuthenticated } from "@/lib/auth/server";
import { getAiConfig, getAuthConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // El proxy ya protege las rutas; esta verificación es una segunda barrera.
  if (!(await isAuthenticated())) redirect("/ingresar");
  const auth = getAuthConfig();
  const ai = getAiConfig();
  return (
    <AppShell
      info={{
        actor: await getActorName(),
        openAccess: auth.mode === "abierto-local",
        aiEnabled: ai.enabled,
        aiPrivacyNote: ai.enabled ? ai.privacyNote : null,
        voiceHint: null,
      }}
    >
      {children}
    </AppShell>
  );
}

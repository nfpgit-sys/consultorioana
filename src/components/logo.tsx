import { cn } from "./ui/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0f867b" />
      <path
        d="M22 16c-5 0-9 4.2-9 10.2 0 6.4 3 10.5 4.6 16.2 1.2 4.4 2.4 8.6 5.4 8.6 3.6 0 3.4-6.3 5-10.6.8-2.2 2.2-3.4 4-3.4s3.2 1.2 4 3.4c1.6 4.3 1.4 10.6 5 10.6 3 0 4.2-4.2 5.4-8.6C48 36.7 51 32.6 51 26.2 51 20.2 47 16 42 16c-4 0-6.2 2.2-10 2.2S26 16 22 16z"
        fill="#fff"
      />
      <circle cx="45" cy="19" r="6" fill="#9beedf" />
    </svg>
  );
}

export function Logo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={size === "lg" ? "h-12 w-12" : "h-8 w-8"} />
      <span className={cn("font-semibold tracking-tight text-ink", size === "lg" ? "text-3xl" : "text-lg")}>
        consultor<span className="text-brand-600">IA</span>
      </span>
    </span>
  );
}

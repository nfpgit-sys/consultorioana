import { Children, cloneElement, type ComponentProps, isValidElement, type ReactElement, type ReactNode, useId } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-ink placeholder:text-slate-400 shadow-[inset_0_1px_1px_rgb(15_31_36/0.03)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:bg-slate-50 disabled:text-slate-500";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  // Si no se indica htmlFor y el campo tiene un único control, se asocia la etiqueta a ese
  // control automáticamente (lectores de pantalla y tocar la etiqueta enfocan el campo).
  const autoId = useId();
  let labelFor = htmlFor;
  let content = children;
  if (!htmlFor) {
    const items = Children.toArray(children);
    const controls = items.filter(isControl);
    if (controls.length === 1 && !(controls[0] as ReactElement<{ id?: string }>).props.id) {
      labelFor = autoId;
      content = items.map((child) => (child === controls[0] ? cloneElement(child as ReactElement<{ id?: string }>, { id: autoId }) : child));
    }
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={labelFor} className="block text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(opcional)</span>}
      </label>
      {content}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function NumberInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="text" inputMode="decimal" autoComplete="off" className={cn(control, "h-11 tabular", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 appearance-none bg-[length:1.1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235b6b70'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-line accent-brand-600" {...props} />
      <span>{label}</span>
    </label>
  );
}

const CONTROLS: unknown[] = ["input", "select", "textarea", Input, NumberInput, Select, Textarea];

function isControl(child: unknown): boolean {
  return isValidElement(child) && CONTROLS.includes(child.type);
}

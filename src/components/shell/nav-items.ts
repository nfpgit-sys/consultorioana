import {
  ArrowLeftRight,
  BarChart3,
  FileScan,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/inventario", label: "Inventario", icon: Package },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/compras", label: "Compras", icon: ShoppingCart },
  { href: "/gastos", label: "Gastos", icon: Wallet },
  { href: "/facturas", label: "Facturas", icon: FileScan },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/proveedores", label: "Proveedores", icon: Truck },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export const MOBILE_PRIMARY = ["/", "/inventario", "/compras"];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

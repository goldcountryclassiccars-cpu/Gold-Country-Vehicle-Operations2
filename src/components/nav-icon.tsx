"use client";

import {
  Archive,
  BadgeCheck,
  Banknote,
  BarChart3,
  Camera,
  Car,
  ClipboardCheck,
  FileCheck,
  FileSignature,
  FileText,
  Handshake,
  Kanban,
  LayoutDashboard,
  Megaphone,
  Plug,
  Receipt,
  Search,
  Settings,
  TrendingUp,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Archive,
  BadgeCheck,
  Banknote,
  BarChart3,
  Camera,
  Car,
  ClipboardCheck,
  FileCheck,
  FileSignature,
  FileText,
  Handshake,
  Kanban,
  LayoutDashboard,
  Megaphone,
  Plug,
  Receipt,
  Search,
  Settings,
  TrendingUp,
  Truck,
  Wrench,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Car;
  return <Icon aria-hidden="true" className={className} />;
}

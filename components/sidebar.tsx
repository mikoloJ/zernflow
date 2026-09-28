"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  MessageCircleReply,
  GitBranch,
  MessageSquare,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  Sprout,
  Plug,
  Settings,
  LogOut,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { Database } from "@/lib/types/database";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

// Same external-store pattern as the theme class above, so reading
// localStorage never causes a setState-in-effect or a hydration mismatch:
// the store starts as "false" for every render (server and first client
// paint), then this subscription's initial notify flips it to whatever was
// persisted, and any other tab flipping it updates this one too.
const collapsedListeners = new Set<() => void>();
function subscribeToCollapsed(callback: () => void) {
  collapsedListeners.add(callback);
  function onStorage(e: StorageEvent) {
    if (e.key === "sidebar-collapsed") callback();
  }
  window.addEventListener("storage", onStorage);
  // Fire once on subscribe so the real (localStorage-backed) value replaces
  // the SSR-safe "false" default immediately after mount.
  queueMicrotask(callback);
  return () => {
    collapsedListeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}
function getCollapsedSnapshot() {
  return localStorage.getItem("sidebar-collapsed") === "true";
}
function setCollapsedStore(next: boolean) {
  localStorage.setItem("sidebar-collapsed", String(next));
  collapsedListeners.forEach((cb) => cb());
}

const navigation = [
  { name: "Automations", href: "/dashboard/automations", icon: MessageCircleReply },
  { name: "Flows", href: "/dashboard/flows", icon: GitBranch },
  { name: "Inbox", href: "/dashboard/inbox", icon: MessageSquare },
  { name: "Contacts", href: "/dashboard/contacts", icon: Users },
  { name: "Broadcasts", href: "/dashboard/broadcasts", icon: Radio },
  { name: "Sequences", href: "/dashboard/sequences", icon: ListOrdered },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { name: "Growth", href: "/dashboard/growth", icon: Sprout },
  { name: "Channels", href: "/dashboard/channels", icon: Plug },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar({
  workspace,
  workspaces,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  workspaces: WorkspaceItem[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  // Persisted across sessions so the sidebar stays collapsed/expanded the
  // way the operator left it.
  const collapsed = useSyncExternalStore(
    subscribeToCollapsed,
    getCollapsedSnapshot,
    () => false
  );

  function toggleCollapsed() {
    setCollapsedStore(!collapsed);
  }

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div
      className={cn(
        "relative flex h-full flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <button
        onClick={toggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-sidebar text-sidebar-foreground/60 shadow-sm hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      >
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>

      <div className="border-b border-sidebar-border px-3 py-3">
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} collapsed={collapsed} />
      </div>

      <nav className="flex-1 space-y-1 overflow-x-hidden p-3">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center px-0" : "px-3",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <button
          onClick={toggleTheme}
          title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed ? "justify-center px-0" : "px-3"
          )}
        >
          {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {!collapsed && (dark ? "Light mode" : "Dark mode")}
        </button>
        <button
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed ? "justify-center px-0" : "px-3"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </div>
  );
}

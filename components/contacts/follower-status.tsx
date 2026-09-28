"use client";

import { useState } from "react";
import { RefreshCw, UserCheck, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { refreshFollowerStatus } from "@/lib/actions/contacts";

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Shows whether a contact follows the connected Instagram account, with a
 * manual refresh. Meta's API only ever confidently confirms a follow — it
 * never asserts "not a follower" — so the only states shown are "Follower"
 * (confirmed) and "Unconfirmed" (never checked, or checked and not
 * confirmed); there is no "Not a follower" state because the platform never
 * gives us that answer.
 */
export function FollowerStatus({
  contactId,
  isFollower,
  checkedAt,
}: {
  contactId: string;
  isFollower: boolean | null;
  checkedAt: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState({ isFollower, checkedAt });

  async function handleRefresh() {
    setPending(true);
    setError(null);
    const result = await refreshFollowerStatus(contactId);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setState({
      isFollower: result.isFollower ?? null,
      checkedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border p-3">
      {state.isFollower ? (
        <UserCheck className="h-4 w-4 flex-shrink-0 text-emerald-600" />
      ) : (
        <HelpCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {state.isFollower ? "Follows your account" : "Follow status unconfirmed"}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.checkedAt
            ? `Checked ${formatCheckedAt(state.checkedAt)}`
            : "Never checked"}
          {error && <span className="text-destructive"> · {error}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={pending}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        )}
      >
        <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
        {pending ? "Checking…" : "Check"}
      </button>
    </div>
  );
}

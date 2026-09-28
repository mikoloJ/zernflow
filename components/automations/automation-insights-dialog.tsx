"use client";

import { useEffect, useState } from "react";
import { Loader2, X, MessageSquareOff, CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface LogRow {
  id: string;
  author_name: string | null;
  author_username: string | null;
  comment_text: string;
  dm_sent: boolean;
  reply_sent: boolean;
  created_at: string;
}

function formatWhen(dateString: string) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Who this comment automation actually matched, and whether each of them
// got a DM — the per-account breakdown behind the "N comments · N DMs"
// summary line shown on the automations list.
export function AutomationInsightsDialog({
  automationId,
  automationName,
  onClose,
}: {
  automationId: string;
  automationName: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LogRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("comment_logs")
        .select("id, author_name, author_username, comment_text, dm_sent, reply_sent, created_at")
        .eq("matched_automation_id", automationId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled) {
        setRows(data ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [automationId]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Insights</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{automationName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <MessageSquareOff className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No comments matched yet</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Accounts that trigger this automation, and whether they received a DM, will show up here.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Account</th>
                  <th className="px-4 py-2 text-left font-medium">Comment</th>
                  <th className="px-4 py-2 text-left font-medium">DM</th>
                  <th className="px-4 py-2 text-left font-medium">Reply</th>
                  <th className="px-5 py-2 text-left font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-2.5 font-medium">
                      {row.author_username ? `@${row.author_username}` : row.author_name || "Unknown"}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground" title={row.comment_text}>
                      {row.comment_text}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.dm_sent ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.reply_sent ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                      {formatWhen(row.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

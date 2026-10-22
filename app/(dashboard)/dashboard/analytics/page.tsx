import { getWorkspace } from "@/lib/workspace";
import { AnalyticsView } from "./analytics-view";

export default async function AnalyticsPage() {
  const { workspace, supabase } = await getWorkspace();

  const nowDate = new Date();
  const thirtyDaysAgo = new Date(
    nowDate.getTime() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const now = nowDate.toISOString();

  // Fetch ALL initial analytics data in parallel on the server
  const [
    flowsRes,
    contactsRes,
    sentRes,
    failedRes,
    startsRes,
    completionsRes,
    flowsListRes,
    contactEvents,
    msgEvents,
    commentLogsRes,
  ] = await Promise.all([
    supabase
      .from("flows")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
    supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id),
    supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("event_type", "message_sent")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now),
    supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("event_type", "message_failed")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now),
    supabase
      .from("analytics_events")
      .select("flow_id")
      .eq("workspace_id", workspace.id)
      .eq("event_type", "flow_started")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .not("flow_id", "is", null),
    supabase
      .from("analytics_events")
      .select("flow_id")
      .eq("workspace_id", workspace.id)
      .eq("event_type", "flow_completed")
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .not("flow_id", "is", null),
    supabase
      .from("flows")
      .select("id, name")
      .eq("workspace_id", workspace.id),
    supabase
      .from("contacts")
      .select("created_at")
      .eq("workspace_id", workspace.id)
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .order("created_at"),
    supabase
      .from("analytics_events")
      .select("event_type, created_at")
      .eq("workspace_id", workspace.id)
      .in("event_type", ["message_sent", "message_failed"])
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .order("created_at"),
    supabase
      .from("comment_logs")
      .select("matched_trigger_id, matched_automation_id, dm_sent")
      .eq("workspace_id", workspace.id)
      .gte("created_at", thirtyDaysAgo)
      .lte("created_at", now)
      .or("matched_trigger_id.not.is.null,matched_automation_id.not.is.null"),
  ]);

  const [{ data: commentTriggers }, { data: commentAutomations }] = await Promise.all([
    supabase.from("triggers").select("id, flow_id").eq("type", "comment_keyword"),
    supabase
      .from("comment_automations")
      .select("id, name")
      .eq("workspace_id", workspace.id),
  ]);

  // Build flow performance data
  const flowNames = new Map(
    (flowsListRes.data ?? []).map((f) => [f.id, f.name])
  );
  const startCounts = new Map<string, number>();
  (startsRes.data ?? []).forEach((e) => {
    if (e.flow_id) startCounts.set(e.flow_id, (startCounts.get(e.flow_id) ?? 0) + 1);
  });
  const completionCounts = new Map<string, number>();
  (completionsRes.data ?? []).forEach((e) => {
    if (e.flow_id) completionCounts.set(e.flow_id, (completionCounts.get(e.flow_id) ?? 0) + 1);
  });
  const allFlowIds = new Set([...startCounts.keys(), ...completionCounts.keys()]);
  const flowPerformance = Array.from(allFlowIds)
    .map((fid) => {
      const starts = startCounts.get(fid) ?? 0;
      const completions = completionCounts.get(fid) ?? 0;
      const dropOffRate = starts > 0 ? Math.round(((starts - completions) / starts) * 100) : 0;
      return { id: fid, name: flowNames.get(fid) ?? "Unknown Flow", starts, completions, dropOffRate };
    })
    .sort((a, b) => b.starts - a.starts)
    .slice(0, 10);

  // Build comment-trigger delivery stats: how many commenters matched a
  // flow trigger or comment automation, and of those, how many actually got
  // the DM vs. didn't (comment_logs.dm_sent), per trigger/automation.
  const triggerFlowName = new Map(
    (commentTriggers ?? []).map((t) => [t.id, flowNames.get(t.flow_id) ?? "Unknown Flow"])
  );
  const automationName = new Map((commentAutomations ?? []).map((a) => [a.id, a.name]));

  interface DeliveryAgg {
    id: string;
    name: string;
    kind: "flow" | "automation";
    matched: number;
    sent: number;
  }
  const deliveryById = new Map<string, DeliveryAgg>();
  for (const row of commentLogsRes.data ?? []) {
    const key = row.matched_trigger_id
      ? `trigger:${row.matched_trigger_id}`
      : row.matched_automation_id
        ? `automation:${row.matched_automation_id}`
        : null;
    if (!key) continue;
    const name = row.matched_trigger_id
      ? triggerFlowName.get(row.matched_trigger_id) ?? "Unknown Flow"
      : automationName.get(row.matched_automation_id!) ?? "Unknown Automation";
    const kind: DeliveryAgg["kind"] = row.matched_trigger_id ? "flow" : "automation";
    const existing = deliveryById.get(key) ?? { id: key, name, kind, matched: 0, sent: 0 };
    existing.matched++;
    if (row.dm_sent) existing.sent++;
    deliveryById.set(key, existing);
  }
  const commentDelivery = Array.from(deliveryById.values())
    .map((d) => ({
      ...d,
      notSent: d.matched - d.sent,
      deliveryRate: d.matched > 0 ? Math.round((d.sent / d.matched) * 100) : 0,
    }))
    .sort((a, b) => b.matched - a.matched);

  // Build daily contact growth
  const growthByDay = new Map<string, number>();
  (contactEvents.data ?? []).forEach((e) => {
    const day = e.created_at.split("T")[0];
    growthByDay.set(day, (growthByDay.get(day) ?? 0) + 1);
  });
  const startDate = new Date(thirtyDaysAgo);
  const endDate = new Date(now);
  const contactGrowth: { date: string; count: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split("T")[0];
    contactGrowth.push({ date: dayStr, count: growthByDay.get(dayStr) ?? 0 });
  }

  // Build daily message volume
  const sentByDay = new Map<string, number>();
  const failedByDay = new Map<string, number>();
  (msgEvents.data ?? []).forEach((e) => {
    const day = e.created_at.split("T")[0];
    if (e.event_type === "message_sent") {
      sentByDay.set(day, (sentByDay.get(day) ?? 0) + 1);
    } else {
      failedByDay.set(day, (failedByDay.get(day) ?? 0) + 1);
    }
  });
  const messageVolume: { date: string; sent: number; failed: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split("T")[0];
    messageVolume.push({
      date: dayStr,
      sent: sentByDay.get(dayStr) ?? 0,
      failed: failedByDay.get(dayStr) ?? 0,
    });
  }

  return (
    <AnalyticsView
      workspaceId={workspace.id}
      initialData={{
        stats: {
          totalFlows: flowsRes.count ?? 0,
          totalContacts: contactsRes.count ?? 0,
          messagesSent: sentRes.count ?? 0,
          messagesFailed: failedRes.count ?? 0,
        },
        flowPerformance,
        commentDelivery,
        contactGrowth,
        messageVolume,
      }}
    />
  );
}

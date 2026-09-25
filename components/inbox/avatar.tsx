"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Profile picture with an initials fallback (Meta picture URLs expire). */
export function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "?").trim().replace(/^@/, "").charAt(0).toUpperCase() || "?";

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-medium text-slate-700 dark:from-slate-700 dark:to-slate-600 dark:text-slate-100",
        className,
      )}
    >
      {initial}
    </div>
  );
}

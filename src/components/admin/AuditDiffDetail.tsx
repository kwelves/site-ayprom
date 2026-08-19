"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { auditChangedFieldsLabel, auditFieldDiffs, formatAuditValue, type AuditFieldDiff } from "@/lib/admin/audit-labels";
import { PRODUCT_AVAILABILITY_LABELS, isProductAvailability } from "@/lib/admin/product-availability";
import { cn } from "@/lib/utils";
import type { AuditLogEntry } from "@/lib/admin/queries";

// The journal shows raw column values by default (formatAuditValue), which
// is correct for free-text fields but unreadable for enum-style ones an
// admin actually recognizes by their Russian label — availability is the
// one such field this admin exposes today.
function formatAuditFieldValue(field: string, value: unknown): string {
  if (field === "availability" && typeof value === "string" && isProductAvailability(value)) {
    return PRODUCT_AVAILABILITY_LABELS[value];
  }
  return formatAuditValue(value);
}

interface AuditDiffDetailProps {
  entry: AuditLogEntry;
}

// Summary line is always visible; the value-level diff (when captured —
// see the before/after migration) expands on demand so a long list of
// entries stays scannable by default.
export function AuditDiffDetail({ entry }: AuditDiffDetailProps) {
  const [open, setOpen] = useState(false);
  const diffs = auditFieldDiffs(entry);

  if (!diffs || diffs.length === 0) {
    return <span className="text-muted-foreground">{auditChangedFieldsLabel(entry.action, entry.changedFields)}</span>;
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {auditChangedFieldsLabel(entry.action, entry.changedFields)}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-fast ease-ui", open && "rotate-180")} />
      </button>
      {open && (
        <dl className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2.5 text-xs">
          {diffs.map((diff) => (
            <DiffRow key={diff.field} diff={diff} action={entry.action} />
          ))}
        </dl>
      )}
    </div>
  );
}

function DiffRow({ diff, action }: { diff: AuditFieldDiff; action: string }) {
  return (
    <div>
      <dt className="font-medium text-card-foreground">{diff.field}</dt>
      <dd className="text-muted-foreground">
        {action === "UPDATE" ? (
          <>
            {formatAuditFieldValue(diff.field, diff.before)} <span aria-hidden="true">→</span>{" "}
            {formatAuditFieldValue(diff.field, diff.after)}
          </>
        ) : (
          formatAuditFieldValue(diff.field, action === "DELETE" ? diff.before : diff.after)
        )}
      </dd>
    </div>
  );
}

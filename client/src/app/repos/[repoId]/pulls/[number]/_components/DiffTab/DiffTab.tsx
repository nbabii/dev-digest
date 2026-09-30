"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile, FindingRecord } from "@devdigest/shared";
import { useSmartOrder } from "./useSmartOrder";
import { SegmentedToggle } from "./_components/SegmentedToggle";
import { DiffFinding } from "./_components/DiffFinding";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** All findings across runs; dismissed ones are filtered by the viewer. */
  findings?: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
}

export function DiffTab({ prId, filesCount, files, canComment, findings, repoFullName, headSha }: DiffTabProps) {
  const t = useTranslations("shell");
  const [order, setOrder] = useSmartOrder();
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;
  const totalAdditions = files.reduce((n, f) => n + f.additions, 0);
  const totalDeletions = files.reduce((n, f) => n + f.deletions, 0);

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const renderFinding = React.useCallback(
    (f: FindingRecord) =>
      prId ? <DiffFinding f={f} prId={prId} repoFullName={repoFullName} headSha={headSha} /> : null,
    [prId, repoFullName, headSha],
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <SegmentedToggle
              ariaLabel={t("diffViewer.orderLabel")}
              value={order}
              onChange={setOrder}
              options={[
                { value: "smart", label: t("diffViewer.orderSmart") },
                { value: "original", label: t("diffViewer.orderOriginal") },
              ]}
            />
          </span>
        }
      >
        Files changed · {filesCount} files ·{" "}
        <span data-testid="diff-total-additions" style={{ color: "var(--code-add-text)" }}>
          +{totalAdditions}
        </span>{" "}
        <span data-testid="diff-total-deletions" style={{ color: "var(--code-del-text)" }}>
          −{totalDeletions}
        </span>
      </SectionLabel>
      <DiffViewer
        files={files}
        commenting={commenting}
        findings={findings}
        renderFinding={renderFinding}
        order={order}
      />
    </section>
  );
}

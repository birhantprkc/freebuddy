import { useEffect, useRef, useState } from "react";
import { Alert, Button, Space } from "antd";
import { useTranslation } from "react-i18next";

import { delegationClient } from "@/services/delegation/client";
import type { DelegationRunRow } from "@/services/delegation/client";

const POLL_INTERVAL_MS = 1500;

interface PendingApproval {
  approvalId: string;
  runId: string;
}

/**
 * Inline write-approval card shown in the conversation chat view. Polls the
 * delegation run linked to the conversation; while a run is blocked on a
 * pending write approval, renders Approve / Reject actions. Renders nothing
 * otherwise so it stays non-disruptive.
 */
export function DelegationApprovalCard({
  conversationId
}: {
  conversationId: string;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState<DelegationRunRow | undefined>(undefined);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const poll = async () => {
      try {
        const currentRun = await delegationClient.getRunByConversation(
          conversationId
        );
        if (cancelled) return;
        setRun(currentRun);
        if (!currentRun || currentRun.status !== "blocked") {
          setApproval(null);
          return;
        }
        const pending = await delegationClient.listPendingApprovals(
          currentRun.id
        );
        if (cancelled) return;
        setApproval(pending.length > 0 ? pending[0] : null);
      } catch {
        if (!cancelled) {
          setRun(undefined);
          setApproval(null);
        }
      }
    };

    const schedule = () => {
      clearTimer();
      timerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        await poll();
        if (cancelled) return;
        schedule();
      }, POLL_INTERVAL_MS);
    };

    void poll();
    schedule();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [conversationId]);

  const decide = async (approved: boolean) => {
    if (!run || !approval || submitting) return;
    setSubmitting(true);
    try {
      await delegationClient.approveWrite({
        runId: run.id,
        approvalId: approval.approvalId,
        approved
      });
    } catch {
      // Approval IPC failed; allow retry by re-enabling buttons.
      setSubmitting(false);
    }
  };

  if (!run || run.status !== "blocked" || !approval) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      message={t("workflow.delegation.approvePrompt")}
      action={
        <Space>
          <Button
            size="small"
            type="primary"
            disabled={submitting}
            onClick={() => void decide(true)}
          >
            {t("workflow.delegation.approve")}
          </Button>
          <Button
            size="small"
            danger
            disabled={submitting}
            onClick={() => void decide(false)}
          >
            {t("workflow.delegation.reject")}
          </Button>
        </Space>
      }
      style={{ margin: "8px 0" }}
    />
  );
}

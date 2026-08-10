import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Typography
} from "antd";
import { useTranslation } from "react-i18next";

import type {
  DelegationPolicy,
  DelegationRosterEntry
} from "@/services/workflowTeams/types";
import { useDelegationTeamStore } from "@/store/delegationStore";
import { useConversationStore } from "@/store/conversationStore";

const { TextArea } = Input;

function defaultPolicy(): DelegationPolicy {
  return {
    allowWrites: true,
    requireApprovalBeforeDelegateWrite: true,
    maxDepth: 3,
    delegateTimeoutMs: 600000,
    maxConcurrentDelegates: 1,
    stopOnDelegateFailure: false
  };
}

function newEntry(id: string): DelegationRosterEntry {
  return { id, label: "", agentId: "", capability: "", canWrite: false };
}

export function DelegationTeamEditor({
  teamId,
  onDone
}: {
  teamId?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const create = useDelegationTeamStore((s) => s.create);
  const update = useDelegationTeamStore((s) => s.update);
  const existing = useDelegationTeamStore((s) =>
    teamId ? s.getById(teamId) : undefined
  );
  const members = useConversationStore((s) => s.members);

  const agentOptions = useMemo(
    () => members.map((m) => ({ value: m.id, label: m.name })),
    [members]
  );

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [roster, setRoster] = useState<DelegationRosterEntry[]>(
    existing?.roster && existing.roster.length > 0
      ? existing.roster
      : [newEntry("r-1")]
  );
  const [entryRoleId, setEntryRoleId] = useState(existing?.entryRoleId ?? "r-1");
  const [policy, setPolicy] = useState<DelegationPolicy>(
    existing?.policy ?? defaultPolicy()
  );
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setRoster(
        existing.roster.length > 0 ? existing.roster : [newEntry("r-1")]
      );
      setEntryRoleId(existing.entryRoleId);
      setPolicy(existing.policy);
    } else {
      setName("");
      setDescription("");
      setRoster([newEntry("r-1")]);
      setEntryRoleId("r-1");
      setPolicy(defaultPolicy());
    }
    setErrors([]);
  }, [existing]);

  const setEntry = (patch: Partial<DelegationRosterEntry>, id: string) =>
    setRoster((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addEntry = () =>
    setRoster((rs) => [...rs, newEntry(`r-${Date.now().toString(36)}`)]);

  const removeEntry = (id: string) =>
    setRoster((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    if (!name.trim()) {
      setErrors([t("workflow.teamNameRequired")]);
      return;
    }
    const invalidRoster =
      roster.length === 0 ||
      roster.some((r) => !r.label.trim() || !r.agentId.trim());
    if (invalidRoster) {
      setErrors([t("workflow.delegation.errors.invalidRoster")]);
      return;
    }
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const finalEntryRoleId = roster.some((r) => r.id === entryRoleId)
      ? entryRoleId
      : (roster[0]?.id ?? entryRoleId);
    setErrors([]);
    try {
      if (existing) {
        await update(existing.id, {
          name: trimmedName,
          description: trimmedDescription || null,
          enabled: existing.enabled,
          entryRoleId: finalEntryRoleId,
          roster,
          policy
        });
      } else {
        await create({
          id: `team-delegation-${Date.now().toString(36)}`,
          name: trimmedName,
          description: trimmedDescription || undefined,
          enabled: true,
          source: "user",
          entryRoleId: finalEntryRoleId,
          roster,
          policy
        });
      }
      onDone();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t("errors.unknown")]);
    }
  };

  return (
    <Card
      title={t("workflow.delegation.editorTitle")}
      extra={
        <Space>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button type="primary" onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Space>
      }
    >
      {errors.length > 0 && (
        <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }}>
          {errors.map((e, i) => (
            <Typography.Text key={i} type="danger">
              {e}
            </Typography.Text>
          ))}
        </Space>
      )}

      <Typography.Text strong>
        {t("workflow.delegation.overview")}
      </Typography.Text>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("workflow.delegation.namePlaceholder")}
        style={{ marginTop: 8 }}
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("workflow.delegation.descriptionPlaceholder")}
        style={{ marginTop: 8 }}
      />

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
        {t("workflow.delegation.roster")}
      </Typography.Text>
      {roster.map((r) => (
        <Card key={r.id} size="small" style={{ marginTop: 8 }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Input
              value={r.label}
              onChange={(e) => setEntry({ label: e.target.value }, r.id)}
              placeholder={t("workflow.delegation.labelPlaceholder")}
            />
            <Select
              value={r.agentId || undefined}
              options={agentOptions}
              onChange={(v: string) => setEntry({ agentId: v }, r.id)}
              placeholder={t("workflow.delegation.agentPlaceholder")}
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="label"
            />
            <TextArea
              value={r.capability}
              onChange={(e) => setEntry({ capability: e.target.value }, r.id)}
              placeholder={t("workflow.delegation.capabilityPlaceholder")}
              autoSize={{ minRows: 2 }}
            />
            <Space>
              <Switch
                checked={r.canWrite}
                onChange={(v) => setEntry({ canWrite: v }, r.id)}
              />
              <Typography.Text>
                {t("workflow.delegation.canWrite")}
              </Typography.Text>
              <Button size="small" danger onClick={() => removeEntry(r.id)}>
                {t("common.remove")}
              </Button>
            </Space>
          </Space>
        </Card>
      ))}
      <Button style={{ marginTop: 8 }} onClick={addEntry}>
        {t("workflow.delegation.addRosterEntry")}
      </Button>

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
        {t("workflow.delegation.entryAgent")}
      </Typography.Text>
      <Radio.Group
        value={entryRoleId}
        onChange={(e) => setEntryRoleId(e.target.value as string)}
        style={{ marginTop: 8 }}
      >
        <Space direction="vertical">
          {roster.map((r) => (
            <Radio key={r.id} value={r.id}>
              {r.label || r.id}
            </Radio>
          ))}
        </Space>
      </Radio.Group>

      <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
        {t("workflow.delegation.policy")}
      </Typography.Text>
      <Space wrap style={{ marginTop: 8 }}>
        <InputNumber
          addonAfter={t("workflow.delegation.maxDepth")}
          min={1}
          max={6}
          value={policy.maxDepth}
          onChange={(v) => setPolicy({ ...policy, maxDepth: Number(v) || 3 })}
        />
        <InputNumber
          addonAfter={t("workflow.delegation.timeoutMin")}
          min={1}
          value={Math.round(policy.delegateTimeoutMs / 60000)}
          onChange={(v) =>
            setPolicy({
              ...policy,
              delegateTimeoutMs: (Number(v) || 10) * 60000
            })
          }
        />
        <Space>
          <Switch
            checked={policy.allowWrites}
            onChange={(v) => setPolicy({ ...policy, allowWrites: v })}
          />
          <Typography.Text>
            {t("workflow.delegation.allowWrites")}
          </Typography.Text>
        </Space>
        <Space>
          <Switch
            checked={policy.requireApprovalBeforeDelegateWrite}
            onChange={(v) =>
              setPolicy({ ...policy, requireApprovalBeforeDelegateWrite: v })
            }
          />
          <Typography.Text>
            {t("workflow.delegation.requireApprovalBeforeDelegateWrite")}
          </Typography.Text>
        </Space>
        <Space>
          <Switch
            checked={policy.stopOnDelegateFailure}
            onChange={(v) => setPolicy({ ...policy, stopOnDelegateFailure: v })}
          />
          <Typography.Text>
            {t("workflow.delegation.stopOnDelegateFailure")}
          </Typography.Text>
        </Space>
      </Space>
    </Card>
  );
}

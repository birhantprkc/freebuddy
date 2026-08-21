import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, X } from "lucide-react";

import type { CLIMember } from "@/config/aiMembers";
import { builtinCliMembers } from "@/config/aiMembers";
import { cliClient } from "@/services/cli/client";
import type {
  SessionConfigOption,
  SessionConfigProbeInput
} from "@/services/cli/types";
import { bundledGameEntry, useBrowserStore } from "@/store/browserStore";
import { useCliExecutorStore } from "@/store/cliExecutorStore";
import { useConversationStore } from "@/store/conversationStore";
import { useDetailLayoutStore } from "@/store/detailLayoutStore";

export interface GameSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export type SupportedGameType = "gomoku" | "chinese_chess" | "go";

interface GameOptionDef {
  id: SupportedGameType;
  titleKey: string;
  ready: boolean;
  tagKey?: string;
}

const AVAILABLE_GAMES: GameOptionDef[] = [
  {
    id: "gomoku",
    titleKey: "game.gomoku",
    ready: true
  },
  {
    id: "chinese_chess",
    titleKey: "game.xiangqi",
    ready: true
  },
  {
    id: "go",
    titleKey: "game.go",
    ready: false,
    tagKey: "game.comingSoon"
  }
];

export function GameSetupModal({ open, onClose }: GameSetupModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  const convStore = useConversationStore();
  const members = useMemo(
    () => convStore.members.filter((m) => m.enabled !== false),
    [convStore.members]
  );

  const [selectedGame, setSelectedGame] = useState<SupportedGameType>("gomoku");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedHand, setSelectedHand] = useState<"player_first" | "agent_first">("player_first");
  const [isLaunching, setIsLaunching] = useState(false);

  // Model probing states
  const [modelOptionsByAgent, setModelOptionsByAgent] = useState<
    Record<string, SessionConfigOption[]>
  >({});
  const [modelLoadingByAgent, setModelLoadingByAgent] = useState<
    Record<string, boolean>
  >({});

  // Initialize selected agent
  useEffect(() => {
    if (!open) return;
    if (!selectedAgentId || !members.some((m) => m.id === selectedAgentId)) {
      const defaultAgent =
        members.find((m) => m.id === "cli-butlerbuddy") ||
        members[0] ||
        builtinCliMembers[0];
      if (defaultAgent) {
        setSelectedAgentId(defaultAgent.id);
      }
    }
  }, [open, members, selectedAgentId]);

  const selectedMember: CLIMember | undefined = useMemo(() => {
    return (
      members.find((m) => m.id === selectedAgentId) ||
      builtinCliMembers.find((m) => m.id === selectedAgentId) ||
      members[0] ||
      builtinCliMembers[0]
    );
  }, [members, selectedAgentId]);

  // Session probe input helper
  const sessionProbeInputForAgent = useCallback(
    (agentId: string): SessionConfigProbeInput | undefined => {
      const member =
        members.find((entry) => entry.id === agentId) ||
        builtinCliMembers.find((entry) => entry.id === agentId);
      if (!member) return undefined;
      const resolved = useCliExecutorStore
        .getState()
        .resolve(member.cli.adapter);
      return {
        agentId: member.id,
        adapter: member.cli.adapter,
        binary: member.cli.binary || resolved?.binary,
        extraArgs: [
          ...(resolved?.extraArgs ?? []),
          ...(member.cli.extraArgs ?? [])
        ],
        env: { ...(resolved?.env ?? {}), ...(member.cli.env ?? {}) }
      };
    },
    [members]
  );

  // Probe models for selected agent
  const refreshAgentModels = useCallback(
    async (agentId: string) => {
      if (!agentId || !cliClient.isAvailable()) return;
      const input = sessionProbeInputForAgent(agentId);
      if (!input) return;

      setModelLoadingByAgent((prev) => ({ ...prev, [agentId]: true }));
      try {
        const cached = await cliClient.getCachedSessionConfigOptions(input);
        if (cached && cached.length > 0) {
          setModelOptionsByAgent((prev) => ({ ...prev, [agentId]: cached }));
        }
        const fresh = await cliClient.inspectSessionConfigOptions(input);
        if (fresh && fresh.length > 0) {
          setModelOptionsByAgent((prev) => ({ ...prev, [agentId]: fresh }));
        }
      } catch (err) {
        console.warn("[FreeBuddy] Failed to probe model options for agent:", agentId, err);
      } finally {
        setModelLoadingByAgent((prev) => ({ ...prev, [agentId]: false }));
      }
    },
    [sessionProbeInputForAgent]
  );

  // Load models whenever selected agent changes
  useEffect(() => {
    if (!open || !selectedAgentId) return;
    if (!modelOptionsByAgent[selectedAgentId]) {
      void refreshAgentModels(selectedAgentId);
    }
  }, [open, selectedAgentId, modelOptionsByAgent, refreshAgentModels]);

  // Extract model options for current agent
  const currentModelOption = useMemo(() => {
    if (!selectedAgentId) return undefined;
    const options = modelOptionsByAgent[selectedAgentId] ?? [];
    return (
      options.find((entry) => entry.category === "model") ??
      options.find((entry) => entry.id === "model")
    );
  }, [selectedAgentId, modelOptionsByAgent]);

  const availableModels = useMemo(() => {
    const values = [...(currentModelOption?.values ?? [])];
    return values;
  }, [currentModelOption]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleLaunchMatch = async () => {
    if (!selectedMember || isLaunching) return;
    setIsLaunching(true);
    try {
      const modelName = selectedModel ? ` (${selectedModel})` : "";
      const gameName = selectedGame === "chinese_chess" ? t("game.xiangqi") : t("game.gomoku");
      const gamePath = selectedGame === "chinese_chess" ? "xiangqi" : selectedGame;
      const title = `[${gameName}] vs ${selectedMember.name}${modelName}`;

      const modelOptionId = currentModelOption?.id ?? "model";
      const configOverrides = selectedModel
        ? { [modelOptionId]: selectedModel }
        : undefined;

      const conv = await convStore.newConversation({
        member: selectedMember,
        title,
        kind: "game",
        metadata: {
          gameType: gamePath,
          opponentAgentId: selectedMember.id,
          opponentModel: selectedModel || undefined,
          hand: selectedHand
        },
        configOptionOverrides: configOverrides,
        skillIds: ["game-arena"]
      });

      // Load game URL in built-in browser. Packaged Electron cannot iframe
      // file:// assets from app.asar; bundledGameEntry converts them to a
      // freebuddy-browser path. WebUI uses a same-origin /games/... URL.
      useBrowserStore.getState().navigate(conv.id, bundledGameEntry(gamePath));
      useDetailLayoutStore.getState().setActiveTab("preview");
      useDetailLayoutStore.getState().setDetailCollapsed(false);

      // Send opening welcome prompt
      if (selectedGame === "chinese_chess") {
        if (selectedHand === "player_first") {
          void convStore.sendMessage({
            conversationId: conv.id,
            prompt: t("game.promptXiangqiPlayerFirst")
          });
        } else {
          void convStore.sendMessage({
            conversationId: conv.id,
            prompt: t("game.promptXiangqiAgentFirst")
          });
        }
      } else {
        if (selectedHand === "player_first") {
          void convStore.sendMessage({
            conversationId: conv.id,
            prompt: t("game.promptGomokuPlayerFirst")
          });
        } else {
          void convStore.sendMessage({
            conversationId: conv.id,
            prompt: t("game.promptGomokuAgentFirst")
          });
        }
      }

      onClose();
    } catch (err) {
      console.error("[FreeBuddy] Failed to launch game match:", err);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal game-setup-dialog"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="game-setup-dialog-header">
          <div>
            <h3 id={titleId}>{t("game.gameLobbyTitle")}</h3>
            <p id={descriptionId} className="game-setup-dialog-desc">
              {t("game.gameLobbyDesc")}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="game-setup-dialog-form">
          {/* Game Selection */}
          <div className="game-setup-field">
            <span className="game-setup-field-label">{t("game.gameProject")}</span>
            <div className="game-setup-choice-group">
              {AVAILABLE_GAMES.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className={selectedGame === game.id ? "active" : ""}
                  disabled={!game.ready}
                  onClick={() => game.ready && setSelectedGame(game.id)}
                >
                  {t(game.titleKey)}
                  {game.tagKey ? ` (${t(game.tagKey)})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* AI Agent Selection */}
          <div className="game-setup-field">
            <span className="game-setup-field-label">{t("game.aiOpponent")}</span>
            <div className="custom-select-wrapper">
              <select
                value={selectedAgentId}
                onChange={(e) => {
                  setSelectedAgentId(e.target.value);
                  setSelectedModel("");
                }}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.profile === "butler" ? t("game.butlerAssistant") : m.cli.adapter})
                  </option>
                ))}
              </select>
              <span className="custom-select-arrow">
                <ChevronDown size={14} />
              </span>
            </div>
          </div>

          {/* Model & Hand in 2 Columns */}
          <div className="game-setup-grid-row">
            <div className="game-setup-field">
              <span className="game-setup-field-label">{t("game.gameModel")}</span>
              <div className="custom-select-wrapper">
                <select
                  value={selectedModel}
                  onFocus={() => selectedAgentId && void refreshAgentModels(selectedAgentId)}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  <option value="">{t("game.defaultModel")}</option>
                  {modelLoadingByAgent[selectedAgentId] && availableModels.length === 0 ? (
                    <option disabled>{t("game.loadingModels")}</option>
                  ) : null}
                  {availableModels.map((val) => (
                    <option key={val.id} value={val.id}>
                      {val.name || val.id}
                    </option>
                  ))}
                </select>
                <span className="custom-select-arrow">
                  <ChevronDown size={14} />
                </span>
              </div>
            </div>

            <div className="game-setup-field">
              <span className="game-setup-field-label">{t("game.turnOrder")}</span>
              <div className="game-setup-choice-group two-cols">
                <button
                  type="button"
                  className={selectedHand === "player_first" ? "active" : ""}
                  onClick={() => setSelectedHand("player_first")}
                >
                  {t("game.playerFirst", {
                    piece: selectedGame === "chinese_chess" ? t("game.pieceRed") : t("game.pieceBlack")
                  })}
                </button>
                <button
                  type="button"
                  className={selectedHand === "agent_first" ? "active" : ""}
                  onClick={() => setSelectedHand("agent_first")}
                >
                  {t("game.agentFirst", {
                    piece: selectedGame === "chinese_chess" ? t("game.pieceRed") : t("game.pieceBlack")
                  })}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={isLaunching}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!selectedMember || isLaunching}
            onClick={() => void handleLaunchMatch()}
          >
            {isLaunching ? t("game.launching") : t("game.startMatch")}
          </button>
        </div>
      </div>
    </div>
  );
}

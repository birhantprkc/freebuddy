import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X } from "lucide-react";
import QRCode from "qrcode";

export function RemoteTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<RemoteUser[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [revealed, setRevealed] = useState<{ username: string; password: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const [rootsUserId, setRootsUserId] = useState<string>("");
  const [newRoot, setNewRoot] = useState("");
  const [qr, setQr] = useState<{ url: string; dataUrl: string; expiresAt: number } | null>(null);

  const isWeb = window.freebuddy?.platform === "web";

  const loadRoots = async (userId: string) => {
    if (!userId) {
      setRoots([]);
      return;
    }
    try {
      const r = await window.freebuddy?.remote?.listUserRoots(userId);
      setRoots(r ?? []);
    } catch {
      setRoots([]);
    }
  };

  const refresh = async () => {
    const [s, us] = await Promise.all([
      window.freebuddy?.remote?.getStatus(),
      window.freebuddy?.remote?.listUsers()
    ]);
    setStatus(s ?? null);
    const list = us ?? [];
    setUsers(list);
    const target = rootsUserId || list[0]?.id || "";
    if (target && target !== rootsUserId) setRootsUserId(target);
    await loadRoots(target);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const flash = (msg: string) => {
    setMessage(msg);
    window.setTimeout(() => setMessage(null), 4000);
  };

  const handleToggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const res = await window.freebuddy!.remote!.setEnabled(enabled);
      if (res?.status) setStatus(res.status);
      if (res?.initialPassword) {
        setRevealed({ username: "owner", password: res.initialPassword });
        flash(t("remote.userCreated"));
      } else {
        setRevealed(null);
      }
      void refresh();
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async () => {
    const username = newUsername.trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      flash(t("remote.usernameInvalid"));
      return;
    }
    setBusy(true);
    try {
      const res = await window.freebuddy!.remote!.createUser({ username });
      setNewUsername("");
      setRevealed({ username: res.user.username, password: res.password });
      flash(t("remote.userCreated"));
      void refresh();
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleResetUserPassword = async (id: string, username: string) => {
    setBusy(true);
    try {
      const res = await window.freebuddy!.remote!.resetUserPassword(id);
      if (res) {
        setRevealed({ username, password: res.password });
        flash(t("remote.passwordReset"));
      }
      void refresh();
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    setBusy(true);
    try {
      await window.freebuddy!.remote!.deleteUser(id);
      flash(t("remote.userDeleted"));
      void refresh();
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
      flash(t("common.copied"));
    } catch {
      // ignore
    }
  };

  const handleShowQr = async () => {
    setBusy(true);
    try {
      const res = await window.freebuddy!.remote!.getQrLogin();
      if (!res) {
        flash(t("remote.qrUnavailable"));
        return;
      }
      const dataUrl = await QRCode.toDataURL(res.url, { width: 240, margin: 1 });
      setQr({ url: res.url, dataUrl, expiresAt: Date.now() + res.expiresIn * 1000 });
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const persistRoots = async (next: string[]) => {
    if (!rootsUserId) return;
    try {
      const saved = await window.freebuddy?.remote?.setUserRoots({
        userId: rootsUserId,
        roots: next
      });
      setRoots(saved ?? next);
      flash(t("remote.rootsSaved"));
    } catch (e) {
      flash(String((e as Error)?.message || e));
    }
  };

  const handleAddRoot = async () => {
    const trimmed = newRoot.trim();
    if (!trimmed || !trimmed.startsWith("/")) {
      flash(t("remote.rootsInvalid"));
      return;
    }
    if (roots.includes(trimmed)) {
      setNewRoot("");
      return;
    }
    setNewRoot("");
    await persistRoots([...roots, trimmed]);
  };

  const handleRemoveRoot = async (root: string) => {
    await persistRoots(roots.filter((r) => r !== root));
  };

  const selectRootsUser = async (userId: string) => {
    setRootsUserId(userId);
    await loadRoots(userId);
  };

  if (isWeb) {
    return (
      <section className="settings-section">
        <h3>{t("remote.title")}</h3>
        <p className="settings-hint">{t("remote.desktopOnly")}</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="settings-section">
        <p>...</p>
      </section>
    );
  }

  const enabled = status?.enabled === true;

  return (
    <>
      <section className="settings-section remote-hero-section">
        <div className="remote-card">
          <div className="remote-hero-head">
            <div className="remote-hero-heading">
              <h3>{t("remote.title")}</h3>
              <p className="settings-hint">{t("remote.enableDescription")}</p>
            </div>
            <label className="fb-switch-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-checked={enabled}
                checked={enabled}
                disabled={busy}
                onChange={(e) => void handleToggle(e.target.checked)}
              />
              <span className="fb-switch fb-switch-lg" aria-hidden="true">
                <span className="fb-switch-thumb" />
              </span>
            </label>
          </div>

          <div className={`remote-status-row${status?.running ? " on" : " off"}`}>
            <span className="remote-status-dot" />
            <span>
              {status?.running
                ? t("remote.statusOn", { port: status.port, host: status.host })
                : t("remote.statusOff")}
            </span>
          </div>

          {enabled && status?.running && (
            <>
              <div className="remote-access-card">
                <code className="remote-access-url">{status.accessUrl}</code>
                <button className="permission-btn" onClick={() => copy(status.accessUrl)}>
                  {t("common.copy")}
                </button>
              </div>
              <p className="settings-hint">{t("remote.lanIpHint", { ip: status.lanIp })}</p>
            </>
          )}
        </div>
      </section>

      {enabled && status?.running && (
        <section className="settings-section">
          <h3>{t("remote.qrTitle")}</h3>
          <p className="settings-hint">{t("remote.qrHint")}</p>
          {qr ? (
            <div className="remote-qr-card">
              <img src={qr.dataUrl} alt={t("remote.qrTitle")} className="remote-qr-img" />
              <code className="remote-access-url">{qr.url}</code>
              <div className="remote-qr-actions">
                <button className="permission-btn" onClick={() => copy(qr.url)}>
                  {t("common.copy")}
                </button>
                <button className="permission-btn" disabled={busy} onClick={() => void handleShowQr()}>
                  <RefreshCw size={14} />
                  {t("remote.qrRefresh")}
                </button>
              </div>
              <small className="settings-hint">{t("remote.qrExpires")}</small>
            </div>
          ) : (
            <button
              className="permission-btn permission-btn-primary"
              disabled={busy}
              onClick={() => void handleShowQr()}
            >
              {t("remote.qrShow")}
            </button>
          )}
        </section>
      )}

      {enabled && (
        <section className="settings-section">
          <h3>{t("remote.usersTitle")}</h3>
          <p className="settings-hint">{t("remote.usersDescription")}</p>

          {revealed && (
            <div className="remote-credential-card">
              <div className="remote-credential-head">{t("remote.credentialReveal")}</div>
              <div className="remote-access-row">
                <code className="remote-access-url">
                  <strong>{revealed.username}</strong>
                  <span className="remote-credential-sep">·</span>
                  {revealed.password}
                </code>
                <button className="permission-btn" onClick={() => copy(revealed.password)}>
                  {t("common.copy")}
                </button>
              </div>
              <small className="settings-hint">{t("remote.credentialOnceHint")}</small>
            </div>
          )}

          <div className="remote-user-list">
            {users.map((u) => (
              <div key={u.id} className="remote-user-row">
                <span className="remote-user-name">
                  {u.username}
                  {u.isOwner && <span className="remote-user-badge">{t("remote.ownerBadge")}</span>}
                </span>
                <button
                  className="permission-btn"
                  disabled={busy}
                  onClick={() => void handleResetUserPassword(u.id, u.username)}
                >
                  {t("remote.resetUserPassword")}
                </button>
                {!u.isOwner && (
                  <button
                    className="permission-btn"
                    disabled={busy}
                    onClick={() => void handleDeleteUser(u.id)}
                  >
                    {t("remote.deleteUser")}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="remote-password-input">
            <input
              type="text"
              placeholder={t("remote.usernamePlaceholder")}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateUser();
              }}
            />
            <button
              className="permission-btn permission-btn-primary"
              disabled={busy}
              onClick={() => void handleCreateUser()}
            >
              {t("remote.createUser")}
            </button>
          </div>
          <small className="settings-hint">{t("remote.usernameHint")}</small>
        </section>
      )}

      {enabled && (
        <section className="settings-section">
          <h3>{t("remote.rootsTitle")}</h3>
          <p className="settings-hint">{t("remote.rootsDescription")}</p>
          <div className="remote-roots-user-select">
            <label>
              <span>{t("remote.rootsForUser")}</span>
              <select
                value={rootsUserId}
                onChange={(e) => void selectRootsUser(e.target.value)}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                    {u.isOwner ? ` (${t("remote.ownerBadge")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="remote-workspace-roots">
            {roots.map((root) => (
              <div key={root} className="remote-workspace-root-row">
                <code className="remote-access-url" title={root}>{root}</code>
                <button
                  className="remote-workspace-root-remove"
                  title={t("remote.rootsRemove")}
                  aria-label={t("remote.rootsRemove")}
                  onClick={() => void handleRemoveRoot(root)}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <div className="remote-workspace-root-add">
              <input
                type="text"
                placeholder={t("remote.rootsAddPlaceholder")}
                value={newRoot}
                onChange={(e) => setNewRoot(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddRoot();
                }}
              />
              <button
                className="permission-btn permission-btn-primary"
                onClick={() => void handleAddRoot()}
              >
                {t("remote.rootsAdd")}
              </button>
            </div>
          </div>
        </section>
      )}

      {message && <p className="remote-tab-message">{message}</p>}
    </>
  );
}

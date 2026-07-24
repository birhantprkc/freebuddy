import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function RemoteTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isWeb = window.freebuddy?.platform === "web";

  const refresh = async () => {
    const s = await window.freebuddy?.remote?.getStatus();
    setStatus(s ?? null);
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
        setRevealedPassword(res.initialPassword);
        flash(t("remote.passwordGenerated"));
      } else {
        setRevealedPassword(null);
      }
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleSetPassword = async () => {
    if (newPassword.length < 8) {
      flash(t("remote.passwordTooShort"));
      return;
    }
    setBusy(true);
    try {
      await window.freebuddy!.remote!.setPassword(newPassword);
      setRevealedPassword(null);
      setNewPassword("");
      flash(t("remote.passwordUpdated"));
      void refresh();
    } catch (e) {
      flash(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      const plain = await window.freebuddy!.remote!.resetPassword();
      setRevealedPassword(plain);
      flash(t("remote.passwordGenerated"));
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
      <section className="settings-section">
        <h3>{t("remote.title")}</h3>
        <label className="telemetry-setting-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void handleToggle(e.target.checked)}
          />
          <span>
            <strong>{t("remote.enableLabel")}</strong>
            <small>{t("remote.enableDescription")}</small>
          </span>
        </label>
        {status?.running && (
          <p className="settings-hint">
            {t("remote.listeningOn", { port: status.port, host: status.host })}
          </p>
        )}
      </section>

      {enabled && status?.running && (
        <section className="settings-section">
          <h3>{t("remote.accessTitle")}</h3>
          <div className="remote-access-row">
            <code className="remote-access-url">{status.accessUrl}</code>
            <button className="btn-secondary" onClick={() => copy(status.accessUrl)}>
              {t("common.copy")}
            </button>
          </div>
          <p className="settings-hint">{t("remote.lanIpHint", { ip: status.lanIp })}</p>
        </section>
      )}

      {enabled && (
        <section className="settings-section">
          <h3>{t("remote.passwordTitle")}</h3>
          {revealedPassword ? (
            <div className="remote-access-row">
              <code className="remote-access-url">{revealedPassword}</code>
              <button className="btn-secondary" onClick={() => copy(revealedPassword)}>
                {t("common.copy")}
              </button>
            </div>
          ) : status?.hasPassword ? (
            <p className="settings-hint">{t("remote.passwordSetHint")}</p>
          ) : (
            <p className="settings-hint">{t("remote.noPasswordHint")}</p>
          )}

          <div className="remote-password-input">
            <input
              type="text"
              placeholder={t("remote.newPasswordPlaceholder")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button className="btn-secondary" disabled={busy} onClick={() => void handleSetPassword()}>
              {t("remote.setPassword")}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => void handleReset()}>
              {t("remote.resetPassword")}
            </button>
          </div>
          <small className="settings-hint">{t("remote.passwordMinLength")}</small>
        </section>
      )}

      {message && <p className="settings-hint">{message}</p>}
    </>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import i18next from "i18next";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { debugLogClient } from "@/services/debugLog";
import { useConversationStore } from "@/store/conversationStore";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    console.error("[ErrorBoundary]", error, info.componentStack);
    debugLogClient.error("react_error_boundary", error.message, {
      stack: error.stack?.slice(0, 2000),
      componentStack: info.componentStack?.slice(0, 2000)
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    try {
      useConversationStore.getState().setActive(undefined);
    } catch {
      /* ignore */
    }
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          className="app-error-boundary"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
            background: "var(--bg-app, #18181b)",
            color: "var(--text-primary, #f4f4f5)",
            fontFamily: "var(--font-sans, system-ui, -apple-system, sans-serif)",
            textAlign: "center"
          }}
          role="alert"
        >
          <div
            style={{
              maxWidth: "520px",
              width: "100%",
              padding: "32px",
              background: "var(--bg-card, #27272a)",
              border: "1px solid var(--border-color, #3f3f46)",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.36)"
            }}
          >
            <div
              style={{
                display: "inline-flex",
                padding: "12px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                marginBottom: "16px"
              }}
            >
              <AlertTriangle size={32} strokeWidth={2} />
            </div>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: 600,
                marginBottom: "8px"
              }}
            >
              {i18next.t("errors.somethingWentWrong", {
                defaultValue: "Something went wrong"
              })}
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-muted, #a1a1aa)",
                marginBottom: "20px",
                wordBreak: "break-word"
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "center",
                flexWrap: "wrap",
                marginBottom: "16px"
              }}
            >
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: "var(--primary, #3b82f6)",
                  color: "#fff",
                  border: "none",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer"
                }}
              >
                <Home size={16} />
                {i18next.t("errors.backToHome", { defaultValue: "Return Home" })}
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: "var(--bg-hover, #3f3f46)",
                  color: "var(--text-primary, #f4f4f5)",
                  border: "1px solid var(--border-color, #52525b)",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer"
                }}
              >
                <RefreshCw size={16} />
                {i18next.t("errors.reload", { defaultValue: "Reload" })}
              </button>
            </div>
            {this.state.error.stack ? (
              <details
                style={{
                  textAlign: "left",
                  marginTop: "16px",
                  fontSize: "12px",
                  color: "var(--text-muted, #a1a1aa)"
                }}
              >
                <summary style={{ cursor: "pointer", userSelect: "none" }}>
                  {i18next.t("errors.details", { defaultValue: "Error Details" })}
                </summary>
                <pre
                  style={{
                    marginTop: "8px",
                    padding: "10px",
                    borderRadius: "6px",
                    background: "rgba(0,0,0,0.3)",
                    overflowX: "auto",
                    maxHeight: "180px",
                    fontSize: "11px",
                    lineHeight: "1.4"
                  }}
                >
                  {this.state.error.stack}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

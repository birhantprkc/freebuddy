let windowBlurred = false;

if (typeof window !== "undefined") {
  window.addEventListener("blur", () => {
    windowBlurred = true;
  });
  window.addEventListener("focus", () => {
    windowBlurred = false;
  });
}

export function isWindowBlurred(): boolean {
  return windowBlurred;
}

export function isAppInBackground(): boolean {
  if (typeof document === "undefined") return false;
  const hasFocus =
    typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return document.hidden || windowBlurred || !hasFocus;
}

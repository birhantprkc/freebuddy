import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ButlerBuddyChat } from "./components/ButlerBuddy/ButlerBuddyChat";
import { ButlerBuddyPet } from "./components/ButlerBuddy/ButlerBuddyPet";
import "./i18n";
import "../styles.css";
import { installDebugLogClient } from "./services/debugLog";

installDebugLogClient();

const surface = new URLSearchParams(window.location.search).get("surface");
if (surface) document.documentElement.dataset.surface = surface;

const content =
  surface === "butler-pet" ? (
    <ButlerBuddyPet />
  ) : surface === "butler-chat" ? (
    <ButlerBuddyChat />
  ) : (
    <App />
  );

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>{content}</StrictMode>
);

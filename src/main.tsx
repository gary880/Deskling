import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetOverlay } from "./desktop/PetOverlay";
import { ConversationWindow } from "./desktop/ConversationWindow";
import "./styles.css";

const isPetOverlay = new URLSearchParams(window.location.search).get("view") === "pet";
const isConversationWindow = new URLSearchParams(window.location.search).get("view") === "conversation";
if (isPetOverlay || isConversationWindow) {
  document.documentElement.classList.add("pet-overlay-document");
  document.body.classList.add("pet-overlay-body");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetOverlay ? <PetOverlay /> : isConversationWindow ? <ConversationWindow /> : <App />}
  </StrictMode>,
);

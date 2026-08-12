import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PetOverlay } from "./desktop/PetOverlay";
import "./styles.css";

const isPetOverlay = new URLSearchParams(window.location.search).get("view") === "pet";
if (isPetOverlay) {
  document.documentElement.classList.add("pet-overlay-document");
  document.body.classList.add("pet-overlay-body");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetOverlay ? <PetOverlay /> : <App />}
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTabloBackground, readStoredTabloBackground } from "./config/backgrounds";
import "./styles/tokens.css";
import "./styles/global.css";

applyTabloBackground(readStoredTabloBackground());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

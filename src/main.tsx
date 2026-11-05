import { createRoot } from "react-dom/client";
import App from "./App";
import { initLocale } from "./lib/locale";
import "./styles/global.css";

// Resolve the clock and calendar conventions before the first paint, so nothing
// renders with the wrong week start or hour cycle and then visibly jumps.
initLocale().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});

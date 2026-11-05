import { createRoot } from "react-dom/client";
import { NotificationPopup } from "./components/NotificationPopup";
import { ContextMenu } from "./components/ContextMenu";
import { applyTheme, initialTheme } from "./lib/theme";
import "./styles/global.css";

// Match the main window's theme; the window itself is transparent so only the
// floating card is visible.
applyTheme(initialTheme());
document.body.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <>
    <NotificationPopup />
    <ContextMenu />
  </>,
);

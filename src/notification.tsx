import { createRoot } from "react-dom/client";
import { NotificationPopup } from "./components/NotificationPopup";
import { ContextMenu } from "./components/ContextMenu";
import { initWindowTheme } from "./lib/theme";
import { initLanguage } from "./lib/language";
import "./styles/global.css";

// Match the main window's theme; the window itself is transparent so only the
// floating card is visible.
document.body.style.background = "transparent";

Promise.all([initLanguage(), initWindowTheme()]).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <>
      <NotificationPopup />
      <ContextMenu />
    </>,
  );
});

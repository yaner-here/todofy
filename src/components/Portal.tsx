import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into `document.body`, so a floating
 * popover escapes an ancestor's `overflow: hidden` (and WebKitGTK's habit of
 * treating `position: fixed` inside a scroll container as `absolute`).
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

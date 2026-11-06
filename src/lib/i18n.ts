import { createInstance, type ParseKeys } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    interpolationPrefix: "%{";
    interpolationSuffix: "}";
  }
}

export type MessageKey = ParseKeys<"translation">;
export const i18n = createInstance();

// Bundled resources make helpers usable before the native preference arrives.
void i18n.use(initReactI18next).init({
  initAsync: false,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  interpolation: { prefix: "%{", suffix: "}", escapeValue: false },
});

export const t = i18n.t.bind(i18n);

function updateDocumentLanguage() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  const page = window.location.pathname.split("/").pop();
  if (page === "quickadd.html") document.title = t("language.quickAddTitle");
  else if (page === "notification.html") document.title = t("language.notificationTitle");
}

i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();

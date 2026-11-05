import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  CheckCircleIcon,
  DownloadIcon,
  MicrophoneIcon,
  TrashIcon,
} from "./Icons";
import {
  voiceApi,
  voiceError,
  type VoiceDownloadProgress,
  type VoiceStatus,
} from "../lib/voice";

const MODELS = [
  {
    id: "base",
    label: "voice.baseMultilingual",
    size: "voice.baseSize",
    detail: "voice.baseHint",
  },
  {
    id: "tiny",
    label: "voice.tinyMultilingual",
    size: "voice.tinySize",
    detail: "voice.tinyHint",
  },
] as const;

export function VoiceSettingsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<VoiceDownloadProgress | null>(null);

  useEffect(() => {
    void voiceApi
      .status()
      .then(setStatus)
      .catch((e) => setError(voiceError(e)));
    const unlisten = listen<VoiceDownloadProgress>(
      "voice-download-progress",
      (event) => setProgress(event.payload),
    );
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const run = async (name: string, action: () => Promise<VoiceStatus>) => {
    setBusy(name);
    setError("");
    setProgress(null);
    try {
      setStatus(await action());
      await emit("voice-settings-changed");
    } catch (e) {
      setError(voiceError(e));
      void voiceApi
        .status()
        .then(setStatus)
        .catch(() => {});
    } finally {
      setBusy("");
      setProgress(null);
    }
  };

  const buttonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50";
  const installed = status?.modelsInstalled[status.selectedModel] ?? false;
  const updateAvailable = !!status?.updateVersion;
  const targetEngineInstalled = updateAvailable
    ? status.updateEngineInstalled
    : status?.engineInstalled;
  const downloadLabel =
    busy === "engine"
      ? t("voice.voiceEngine")
      : busy === "base"
        ? t("voice.baseModel")
        : t("voice.tinyModel");
  const downloadPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((100 * progress.received) / progress.total))
      : 0;
  const downloadProgress = busy && progress && (
    <div className="voice-download-progress">
      <div className="flex items-center justify-between gap-3">
        <span>
          {downloadLabel} · {downloadPercent}% ·{" "}
          {Math.round(progress.received / 1024 / 1024)} /{" "}
          {Math.round(progress.total / 1024 / 1024)} MB
        </span>
        <button
          type="button"
          onClick={() => void voiceApi.cancelDownload()}
          className="shrink-0 font-medium text-(--color-accent) hover:underline"
        >
          {t("common.cancel")}
        </button>
      </div>
      <div
        className="voice-download-track"
        role="progressbar"
        aria-label={t("voice.downloadName", { name: downloadLabel })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={downloadPercent}
      >
        <div style={{ width: `${downloadPercent}%` }} />
      </div>
    </div>
  );

  return (
    <section id="voice-settings" className="mb-6 scroll-mt-2">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        {t("voice.voice")}
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-start gap-3 px-4 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-color-accent">
            <MicrophoneIcon width={18} height={18} />
          </span>
          <div>
            <p className="mt-1 text-xs text-muted">
              {t("voice.optionalAndOffByDefaultDownloadTheEngineAndA")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted">
          <span>
            {status?.developmentAssets
              ? t("voice.usingLocalTestFilesInThisDebugBuild")
              : status?.updateVersion
                ? t("voice.updateAvailable", { version: status.updateVersion })
                : status?.catalogVersion
                  ? t("voice.catalogVersion", { version: status.catalogVersion })
                  : t("voice.voiceCatalogLoadsWhenYouChooseADownload")}
          </span>
          {!status?.developmentAssets && (
            <button
              className={buttonClass}
              disabled={!!busy}
              onClick={() => void run("catalog", voiceApi.refreshCatalog)}
            >
              {t("voice.checkForUpdates")}
            </button>
          )}
        </div>

        {status?.developmentAssets && (
          <p className="border-t border-border px-4 py-3 text-xs text-muted">
            {t("voice.chooseTinyBelowThenEnableVoiceModeLocalFilesAre")}
          </p>
        )}

        {!status?.platformSupported && status && (
          <p className="border-t border-border px-4 py-3 text-xs text-(--color-danger)">
            {t("voice.voiceDownloadsAreNotAvailableForThisPlatformYet")}
          </p>
        )}

        <div className="voice-engine-row">
          <span className="voice-engine-mark" aria-hidden="true">
            <DownloadIcon width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{t("voice.voiceEngine")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t("voice.localSpeechProcessingByWhisperCppSeparateOptionalDownload")}
            </p>
          </div>
          <div className="voice-engine-actions">
            {targetEngineInstalled ? (
              <span className="voice-engine-installed">
                <CheckCircleIcon width={16} height={16} /> {t("voice.installed")}
              </span>
            ) : (
              <button
                type="button"
                className="voice-engine-download"
                disabled={
                  !!busy ||
                  !status?.platformSupported ||
                  status?.developmentAssets
                }
                onClick={() =>
                  void run("engine", () => voiceApi.download("engine"))
                }
              >
                <DownloadIcon width={17} height={17} />
                <span>
                  {busy === "engine"
                    ? t("settings.downloading")
                    : status?.engineInstalled
                      ? t("voice.updateVoiceEngine")
                      : t("voice.downloadVoiceEngine")}
                </span>
              </button>
            )}
            {!status?.developmentAssets &&
              (status?.engineInstalled || status?.updateEngineInstalled) && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!!busy}
                  onClick={() =>
                    void run("remove-engine", () => voiceApi.remove("engine"))
                  }
                  aria-label={t("voice.removeVoiceEngine")}
                  title={t("voice.removeVoiceEngine")}
                >
                  <TrashIcon width={14} height={14} />
                </button>
              )}
          </div>
        </div>
        {busy === "engine" && downloadProgress}

        <div className="border-t border-border px-4 py-3.5">
          <p className="mb-2 text-sm font-medium">{t("voice.speechModel")}</p>
          <div className="flex flex-col gap-2">
            {MODELS.map((model) => (
              <div
                key={model.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="radio"
                  name="voice-model"
                  value={model.id}
                  checked={(status?.selectedModel ?? "base") === model.id}
                  disabled={!!busy || !status}
                  onChange={() =>
                    void run(`select-${model.id}`, () =>
                      voiceApi.setModel(model.id),
                    )
                  }
                  aria-label={t("voice.selectModel", { name: t(model.label) })}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {t(model.label)}{" "}
                    <span className="font-normal text-faint">
                      · {status?.developmentAssets ? t("voice.localFile") : t(model.size)}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted">{t(model.detail)}</p>
                </div>
                {(
                  updateAvailable
                    ? status?.updateModelsInstalled[model.id]
                    : status?.modelsInstalled[model.id]
                ) ? (
                  <span className="text-[11px] text-(--color-accent)">
                    {t("voice.installed")}
                  </span>
                ) : (
                  <button
                    className={buttonClass}
                    disabled={
                      !!busy ||
                      !status?.platformSupported ||
                      status?.developmentAssets
                    }
                    onClick={() =>
                      void run(model.id, () =>
                        voiceApi.download("model", model.id),
                      )
                    }
                  >
                    {busy === model.id
                      ? t("settings.downloading")
                      : status?.modelsInstalled[model.id]
                        ? t("voice.update")
                        : t("voice.download")}
                  </button>
                )}
                {!status?.developmentAssets &&
                  (status?.modelsInstalled[model.id] ||
                    status?.updateModelsInstalled[model.id]) && (
                    <button
                      className={buttonClass}
                      disabled={!!busy}
                      onClick={() =>
                        void run(`remove-${model.id}`, () =>
                          voiceApi.remove("model", model.id),
                        )
                      }
                      aria-label={t("voice.removeModel", { name: t(model.label) })}
                    >
                      <TrashIcon width={13} height={13} />
                    </button>
                  )}
              </div>
            ))}
          </div>
        </div>

        {busy !== "engine" && downloadProgress}

        <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("voice.voiceMode")}</p>
            <p className="text-xs text-muted">
              {t("voice.showMicrophoneControlsInTaskCaptureAndJournalEditors")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status?.enabled ?? false}
            disabled={
              !!busy ||
              (!status?.enabled && (!status?.engineInstalled || !installed))
            }
            onClick={() =>
              void run("mode", () => voiceApi.setMode(!status?.enabled))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full disabled:opacity-50 ${status?.enabled ? "bg-(--color-accent)" : "bg-surface-2"}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${status?.enabled ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>
        {status?.engineInstalled && !installed && !status.enabled && (
          <p className="border-t border-border px-4 py-3 text-xs text-muted">
            {t("voice.selectAnInstalledSpeechModelAboveToEnableVoiceMode")}
          </p>
        )}

        {!status?.developmentAssets &&
          (status?.engineInstalled ||
            status?.modelsInstalled.base ||
            status?.modelsInstalled.tiny ||
            status?.updateEngineInstalled ||
            status?.updateModelsInstalled.base ||
            status?.updateModelsInstalled.tiny) && (
            <div className="border-t border-border px-4 py-3">
              <button
                className="text-xs text-(--color-danger) hover:underline disabled:opacity-50"
                disabled={!!busy}
                onClick={() =>
                  void run("remove-all", () => voiceApi.remove("all"))
                }
              >
                {t("voice.removeAllVoiceDownloads")}
              </button>
            </div>
          )}
        {error && (
          <p
            role="alert"
            className="border-t border-border px-4 py-3 text-xs text-(--color-danger)"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

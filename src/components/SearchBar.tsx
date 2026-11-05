import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { displayPriorityName, PRIORITY_VALUES, profileFor } from "../lib/priority";
import { CloseIcon, FlagIcon, SearchIcon } from "./Icons";

export function SearchBar() {
  const { t } = useTranslation();
  const {
    priorityProfiles,
    labels,
    searchQuery,
    filterLabelIds,
    filterPriorities,
    setSearchQuery,
    toggleFilterLabel,
    toggleFilterPriority,
    clearFilters,
  } = useStore();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const hasFilters =
    searchQuery.trim() !== "" ||
    filterLabelIds.length > 0 ||
    filterPriorities.length > 0;

  useEffect(() => {
    if (!open) return;

    const closeWhenOutside = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={toolsRef} className="agenda-tools">
      <div className="compact-search">
        <SearchIcon width={15} height={15} />
        <input
          ref={inputRef}
          id="search-input"
          value={searchQuery}
          onInput={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={t("tasks.searchTasks")}
          aria-label={t("tasks.searchTasks")}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              inputRef.current?.focus();
            }}
            title={t("tasks.clearSearch")}
            aria-label={t("tasks.clearSearch")}
          >
            <CloseIcon width={13} height={13} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`filter-trigger ${hasFilters ? "has-filters" : ""}`}
        aria-expanded={open}
      >
        <FlagIcon width={15} height={15} />
        {t("tasks.filters")}
        {hasFilters && <span>{filterLabelIds.length + filterPriorities.length}</span>}
      </button>

      {open && (
        <div className="filter-popover">
          <div>
            <p>{t("tasks.priority")}</p>
            <div className="filter-options">
              {PRIORITY_VALUES.map((priority) => {
                const profile = profileFor(priority, priorityProfiles);
                return (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => toggleFilterPriority(priority)}
                    className={filterPriorities.includes(priority) ? "is-active" : ""}
                  >
                    <FlagIcon width={12} height={12} style={{ color: profile.color }} />
                    {displayPriorityName(profile)}
                  </button>
                );
              })}
            </div>
          </div>
          {labels.length > 0 && (
            <div>
              <p>{t("labels.labels")}</p>
              <div className="filter-options">
                {labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggleFilterLabel(label.id)}
                    className={filterLabelIds.includes(label.id) ? "is-active" : ""}
                  >
                    <i style={{ background: label.color }} />
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasFilters && (
            <button type="button" className="clear-filter-button" onClick={clearFilters}>
              {t("tasks.clearAllFilters")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Выбор категории: поиск + переход по уровням (сначала верхний, потом подкатегория).
 *
 * Заменяет и плоский <select>, и старый комбобокс: один виджет на форму операции,
 * фильтры и импорт. Пустой запрос — список верхнеуровневых категорий; ввод текста —
 * плоский поиск по всему дереву с показом пути.
 *
 * Список рендерится в портале с fixed-позиционированием: пикер живёт внутри таблицы
 * импорта с overflow-auto, и обычный absolute-дропдаун там обрезался бы.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import type { ExpenseKind } from "@/types/database";

export type PickerCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: ExpenseKind;
  is_archived: boolean;
};

type Props = {
  id?: string;
  value: string;
  onChange: (categoryId: string) => void;
  categories: PickerCategory[];
  /** Показывать только категории этого типа операции */
  kind?: ExpenseKind;
  /** Только верхний уровень (для фильтра на странице финансов) */
  parentsOnly?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Создание категории на лету. Возвращает id созданной категории или null. */
  onCreate?: (name: string, parentId: string | null) => Promise<string | null>;
};

type Entry = { category: PickerCategory; path: string; hasChildren: boolean };

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 320;

export function CategoryPicker({
  id,
  value,
  onChange,
  categories,
  kind,
  parentsOnly = false,
  allowEmpty = false,
  emptyLabel = "Не выбрана",
  placeholder = "Выбрать категорию",
  disabled = false,
  className,
  onCreate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [drillParentId, setDrillParentId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    return categories.filter((c) => {
      if (c.is_archived) return false;
      if (kind && c.kind !== kind) return false;
      if (parentsOnly && c.parent_id != null) return false;
      return true;
    });
  }, [categories, kind, parentsOnly]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, PickerCategory[]>();
    for (const c of visible) {
      if (!c.parent_id) continue;
      const arr = map.get(c.parent_id) ?? [];
      arr.push(c);
      map.set(c.parent_id, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return map;
  }, [visible]);

  const roots = useMemo(
    () =>
      visible
        .filter((c) => c.parent_id == null)
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [visible]
  );

  const pathOf = useCallback(
    (c: PickerCategory): string => {
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      return parent ? `${parent.name} / ${c.name}` : c.name;
    },
    [byId]
  );

  const selectedLabel = useMemo(() => {
    if (!value) return null;
    const c = byId.get(value);
    return c ? pathOf(c) : null;
  }, [value, byId, pathOf]);

  const trimmedQuery = query.trim().toLowerCase();

  /** Что сейчас в списке: результаты поиска, подкатегории раскрытой группы или верхний уровень. */
  const entries = useMemo<Entry[]>(() => {
    if (trimmedQuery) {
      return visible
        .map((c) => ({
          category: c,
          path: pathOf(c),
          hasChildren: (childrenByParent.get(c.id)?.length ?? 0) > 0,
        }))
        .filter((e) => e.path.toLowerCase().includes(trimmedQuery))
        .sort((a, b) => a.path.localeCompare(b.path, "ru"))
        .slice(0, 60);
    }
    if (drillParentId) {
      const children = childrenByParent.get(drillParentId) ?? [];
      return children.map((c) => ({ category: c, path: c.name, hasChildren: false }));
    }
    return roots.map((c) => ({
      category: c,
      path: c.name,
      hasChildren: (childrenByParent.get(c.id)?.length ?? 0) > 0,
    }));
  }, [trimmedQuery, drillParentId, visible, roots, childrenByParent, pathOf]);

  const drillParent = drillParentId ? byId.get(drillParentId) : null;

  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return true;
    return visible.some((c) => c.name.trim().toLowerCase() === trimmedQuery);
  }, [trimmedQuery, visible]);

  const canCreate = Boolean(onCreate) && trimmedQuery.length > 0 && !exactMatch && !!kind;

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, PANEL_WIDTH);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT && r.top > spaceBelow;
    setRect({
      top: openUp ? Math.max(8, r.top - PANEL_MAX_HEIGHT - 4) : r.bottom + 4,
      left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("resize", onScrollOrResize);
    // capture: ловим прокрутку внутренних контейнеров (таблица импорта)
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, reposition]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setDrillParentId(null);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery, drillParentId]);

  const commit = useCallback(
    (categoryId: string) => {
      onChange(categoryId);
      close();
    },
    [onChange, close]
  );

  const pick = useCallback(
    (entry: Entry) => {
      // Клик по группе с подкатегориями раскрывает её; сама группа выбирается кнопкой внутри.
      if (!trimmedQuery && entry.hasChildren && !drillParentId) {
        setDrillParentId(entry.category.id);
        return;
      }
      commit(entry.category.id);
    },
    [trimmedQuery, drillParentId, commit]
  );

  const runCreate = useCallback(async () => {
    if (!onCreate || !trimmedQuery) return;
    setCreating(true);
    try {
      const newId = await onCreate(query.trim(), drillParentId);
      if (newId) commit(newId);
    } finally {
      setCreating(false);
    }
  }, [onCreate, query, trimmedQuery, drillParentId, commit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(entries.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "ArrowRight" && !trimmedQuery) {
        const entry = entries[activeIndex];
        if (entry?.hasChildren && !drillParentId) {
          e.preventDefault();
          setDrillParentId(entry.category.id);
        }
        return;
      }
      if (e.key === "ArrowLeft" && drillParentId) {
        e.preventDefault();
        setDrillParentId(null);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = entries[activeIndex];
        if (entry) pick(entry);
        else if (canCreate) void runCreate();
      }
    },
    [entries, activeIndex, drillParentId, trimmedQuery, close, pick, canCreate, runCreate]
  );

  const panel =
    open && rect
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[60] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            style={{ top: rect.top, left: rect.left, width: rect.width }}
            role="dialog"
          >
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Поиск категории…"
                className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Очистить поиск"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {drillParent && !trimmedQuery && (
              <div className="flex items-center gap-1 border-b border-border/70 bg-muted/40 px-2 py-1">
                <button
                  type="button"
                  className="flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setDrillParentId(null)}
                >
                  <ChevronLeft className="size-3.5" />
                  Все категории
                </button>
                <span className="truncate text-xs font-medium">{drillParent.name}</span>
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
                  onClick={() => commit(drillParent.id)}
                >
                  выбрать группу
                </button>
              </div>
            )}

            <ul
              className="max-h-[280px] overflow-y-auto py-1 text-sm"
              role="listbox"
              aria-label="Категории"
            >
              {allowEmpty && !trimmedQuery && !drillParentId && (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-muted-foreground hover:bg-muted/70"
                    onClick={() => commit("")}
                  >
                    {!value && <Check className="size-3.5 shrink-0" />}
                    <span className={value ? "pl-[1.375rem]" : ""}>{emptyLabel}</span>
                  </button>
                </li>
              )}

              {entries.map((entry, i) => {
                const isSelected = entry.category.id === value;
                const isActive = i === activeIndex;
                return (
                  <li key={entry.category.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                        isActive ? "bg-muted/70" : "hover:bg-muted/50"
                      }`}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => pick(entry)}
                    >
                      {isSelected ? (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate" title={entry.path}>
                        {entry.path}
                      </span>
                      {entry.hasChildren && !trimmedQuery && !drillParentId && (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}

              {entries.length === 0 && (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {trimmedQuery ? "Ничего не найдено" : "Нет категорий"}
                </li>
              )}
            </ul>

            {canCreate && (
              <div className="border-t border-border p-1">
                <button
                  type="button"
                  disabled={creating}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-muted/70 disabled:opacity-50"
                  onClick={() => void runCreate()}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {creating
                      ? "Создание…"
                      : drillParent
                        ? `Создать «${query.trim()}» в «${drillParent.name}»`
                        : `Создать категорию «${query.trim()}»`}
                  </span>
                </button>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={className}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-1 rounded-md border border-input bg-card px-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span
          className={`min-w-0 flex-1 truncate ${selectedLabel ? "" : "text-muted-foreground"}`}
          title={selectedLabel ?? undefined}
        >
          {selectedLabel ?? (allowEmpty ? emptyLabel : placeholder)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {panel}
    </div>
  );
}

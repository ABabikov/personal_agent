"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type ExpenseCategoryOption = { id: string; label: string };

type Props = {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  options: ExpenseCategoryOption[];
  /** Показать первой строкой сброс значения */
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function ExpenseCategoryCombobox({
  id,
  value,
  onChange,
  options,
  allowEmpty = false,
  emptyLabel = "Не указана",
  placeholder = "Поиск по названию…",
  disabled = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(() => {
    if (allowEmpty && !value) return emptyLabel;
    return options.find((o) => o.id === value)?.label ?? "";
  }, [allowEmpty, emptyLabel, options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <Input
        id={id}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-expanded={open}
        aria-controls={open ? `${id ?? "cat"}-listbox` : undefined}
        role="combobox"
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        className="h-8"
      />
      {open && !disabled && (
        <ul
          id={`${id ?? "cat"}-listbox`}
          role="listbox"
          className="absolute z-40 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
        >
          {allowEmpty && (
            <li>
              <button
                type="button"
                role="option"
                className="w-full px-2 py-1.5 text-left text-muted-foreground hover:bg-muted/80"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange("");
                  close();
                }}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {filtered.length === 0 ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">Ничего не найдено</li>
          ) : (
            filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === o.id}
                  className={`w-full truncate px-2 py-1.5 text-left hover:bg-muted/80 ${
                    value === o.id ? "bg-muted/50 font-medium" : ""
                  }`}
                  title={o.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(o.id);
                    close();
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

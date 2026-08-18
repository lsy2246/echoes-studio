import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";

type SelectMenuValue = string | number;

export interface SelectMenuOption<Value extends SelectMenuValue = number> {
  value: Value;
  label: string;
  detail?: string;
}

interface SelectMenuProps<Value extends SelectMenuValue = number> {
  label: string;
  value: Value;
  options: SelectMenuOption<Value>[];
  disabled?: boolean;
  className?: string;
  onChange: (value: Value) => void;
}

export function SelectMenu<Value extends SelectMenuValue = number>({
  label,
  value,
  options,
  disabled = false,
  className,
  onChange,
}: SelectMenuProps<Value>) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={`select-menu${className ? ` ${className}` : ""}${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="select-menu__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span className="select-menu__value">{selected?.label ?? value}</span>
        <Icon name="chevron" size={13} />
      </button>
      {open ? (
        <div className="select-menu__popover" id={`${id}-options`} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "is-selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="select-menu__option-copy">
                <span>{option.label}</span>
                {option.detail ? <small>{option.detail}</small> : null}
              </span>
              {option.value === value ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

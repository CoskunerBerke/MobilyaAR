import React, { useEffect, useState } from 'react';

interface NumericInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  onChange: (nextVal: number) => void;
  className?: string;
  ariaLabel?: string;
}

function formatNum(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '';
  if (decimals <= 0) return String(Math.round(v));
  return String(Number(v.toFixed(decimals)));
}

/**
 * Bug-free numeric input that NEVER clamps or overwrites mid-keystroke.
 * Accepts both Turkish comma (",") and dot ("."), lets you backspace completely,
 * and commits cleanly on Enter, blur, or ArrowUp/ArrowDown stepping.
 */
export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onChange,
  className = '',
  ariaLabel,
}) => {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatNum(value, decimals));

  useEffect(() => {
    if (!focused) {
      setDraft(formatNum(value, decimals));
    }
  }, [value, decimals, focused]);

  const commit = (raw: string) => {
    const normalized = raw.replace(',', '.').trim();
    const parsed = parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNum(value, decimals));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    const rounded = decimals <= 0 ? Math.round(clamped) : Number(clamped.toFixed(decimals));
    setDraft(formatNum(rounded, decimals));
    if (Math.abs(rounded - value) > 1e-6) {
      onChange(rounded);
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const v = e.target.value;
        // Allow empty, minus (when min < 0), digits, single dot or comma
        const re = min < 0 ? /^-?\d*[.,]?\d*$/ : /^\d*[.,]?\d*$/;
        if (re.test(v)) {
          setDraft(v);
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(formatNum(value, decimals));
          setFocused(false);
          e.currentTarget.blur();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const base = parseFloat(draft.replace(',', '.'));
          const next = Math.min(max, (Number.isFinite(base) ? base : value) + step);
          const rounded = decimals <= 0 ? Math.round(next) : Number(next.toFixed(decimals));
          setDraft(formatNum(rounded, decimals));
          onChange(rounded);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const base = parseFloat(draft.replace(',', '.'));
          const next = Math.max(min, (Number.isFinite(base) ? base : value) - step);
          const rounded = decimals <= 0 ? Math.round(next) : Number(next.toFixed(decimals));
          setDraft(formatNum(rounded, decimals));
          onChange(rounded);
        }
      }}
      className={className}
    />
  );
};

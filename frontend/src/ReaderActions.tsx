import { useEffect, useRef, useState } from "react";

import { isIsoDate } from "./dates";

function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  return (
    <details className="date-picker" ref={details}>
      <summary ref={summary}>Valitse päivä</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("date") as HTMLInputElement;
        if (!isIsoDate(input.value)) {
          input.setCustomValidity("Valitse kelvollinen päivämäärä.");
          input.reportValidity();
          return;
        }
        onChange(input.value);
        if (details.current) details.current.open = false;
        summary.current?.focus();
      }}>
        <label>
          Lounaspäivä
          <input
            key={date}
            defaultValue={date}
            max="9999-12-31"
            name="date"
            onInput={(event) => event.currentTarget.setCustomValidity("")}
            required
            type="date"
          />
        </label>
        <button className="button button-dark" type="submit">Näytä lounaat</button>
      </form>
    </details>
  );
}

function CopyLink({ href }: { href: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const fallback = useRef<HTMLInputElement>(null);
  const url = new URL(href, window.location.origin).href;

  useEffect(() => {
    if (status === "failed") fallback.current?.focus();
  }, [status]);

  async function copy() {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="copy-link">
      <button type="button" disabled={status === "copying"} onClick={() => void copy()}>
        Kopioi linkki
      </button>
      <p role="status">
        {status === "copied" ? "Linkki kopioitu." : status === "failed" ? "Kopioi linkki alla olevasta kentästä." : ""}
      </p>
      {status === "failed" && (
        <label>
          Jaettava linkki
          <input ref={fallback} readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </div>
  );
}

export function ReaderActions({ date, href, onDateChange }: {
  date: string;
  href: string;
  onDateChange: (date: string) => void;
}) {
  return (
    <div className="reader-actions">
      <DatePicker date={date} onChange={onDateChange} />
      <CopyLink key={href} href={href} />
    </div>
  );
}

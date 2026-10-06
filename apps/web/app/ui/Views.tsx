"use client";

import { useRef, useState, type ReactNode } from "react";

export interface View {
  id: string;
  label: string;
  hint: string;
  content: ReactNode;
}

/**
 * Three journeys instead of one long scroll: what Atlas does, how the money comes back,
 * and the proof. Panels stay mounted so nothing re-fetches when you switch.
 */
export function Views({ views }: { views: View[] }) {
  const [active, setActive] = useState(views[0]!.id);
  const bar = useRef<HTMLDivElement>(null);

  // Switching should land you at the top of the new panel, not halfway down it.
  function show(id: string) {
    setActive(id);
    const top = bar.current?.getBoundingClientRect().top ?? 0;
    if (top < 0)
      bar.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <>
      <div className="views" role="tablist" aria-label="Sections" ref={bar}>
        {views.map((v) => (
          <button
            key={v.id}
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={v.id === active}
            aria-controls={`panel-${v.id}`}
            className={v.id === active ? "view on" : "view"}
            onClick={() => show(v.id)}
          >
            <b>{v.label}</b>
            <span>{v.hint}</span>
          </button>
        ))}
      </div>
      {views.map((v) => (
        <div
          key={v.id}
          role="tabpanel"
          id={`panel-${v.id}`}
          aria-labelledby={`tab-${v.id}`}
          hidden={v.id !== active}
        >
          {v.content}
        </div>
      ))}
    </>
  );
}

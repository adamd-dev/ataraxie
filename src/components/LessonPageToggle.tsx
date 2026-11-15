"use client";

import { useId, useState } from "react";
import { LessonPage } from "./LessonPage";

/** Button that reveals the lesson page (and loads it only then, so closed corrections cost nothing). */
export function LessonPageToggle({ questionId, excerpt, page }: { questionId: string; excerpt: string | null; page: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="link-quiet inline-flex min-h-11 items-center text-sm font-medium"
      >
        {open ? "Masquer la page du cours" : `Voir la page ${page} du cours`}
      </button>
      {open && (
        <div id={panelId}>
          <LessonPage questionId={questionId} excerpt={excerpt} page={page} />
        </div>
      )}
    </div>
  );
}

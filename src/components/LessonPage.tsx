"use client";

import { useEffect, useRef, useState } from "react";
import { isInExcerpt, normalizeText } from "@/lib/lesson-page";

type Box = { left: number; top: number; width: number; height: number };
type State = { status: "loading" } | { status: "ready"; highlighted: boolean } | { status: "error"; message: string };

/**
 * Draws the one lesson page that justifies a question (served by /api/lesson-page) and highlights the quoted passage
 * when the PDF has real text. pdf.js is loaded only when someone opens the page.
 */
export function LessonPage({ questionId, excerpt, page }: { questionId: string; excerpt: string | null; page?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setState({ status: "loading" });
    setBoxes([]);

    (async () => {
      try {
        const res = await fetch(`/api/lesson-page/${questionId}${page ? `?page=${page}` : ""}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = new Uint8Array(await res.arrayBuffer());

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        destroy = () => void doc.destroy();
        const pdfPage = await doc.getPage(1);

        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (cancelled || !canvas || !wrap) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: wrap.clientWidth / base.width });
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        await pdfPage.render({
          canvasContext: ctx,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        }).promise;

        const target = normalizeText(excerpt ?? "");
        const found: Box[] = [];
        if (target) {
          const text = await pdfPage.getTextContent();
          for (const item of text.items) {
            if (!("str" in item) || !isInExcerpt(item.str, target)) continue;
            // Text-space origin → viewport (CSS px); y is the baseline, so the box goes up by the font height.
            const [, , c, d, e, f] = pdfjs.Util.transform(viewport.transform, item.transform);
            const height = Math.hypot(c, d);
            found.push({ left: e, top: f - height, width: item.width * viewport.scale, height: height * 1.2 });
          }
        }
        if (!cancelled) {
          setBoxes(found);
          setState({ status: "ready", highlighted: found.length > 0 });
        }
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [questionId, excerpt, page]);

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border border-line bg-white">
        <canvas ref={canvasRef} className="block" role="img" aria-label="Page du cours du professeur" />
        {boxes.map((b, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute rounded-sm bg-yellow-300/50 mix-blend-multiply"
            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          />
        ))}
        {state.status === "loading" && <p className="p-6 text-sm text-muted">Chargement de la page du cours…</p>}
      </div>
      {state.status === "error" && <p className="text-sm text-bad">Page du cours indisponible : {state.message}</p>}
      {state.status === "ready" && excerpt && !state.highlighted && (
        <p className="text-xs text-muted">
          Passage non surligné (page scannée ou image) : cherchez l&apos;extrait ci-dessus sur la page.
        </p>
      )}
    </div>
  );
}

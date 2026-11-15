// Helpers for showing students the one lesson page that justifies an answer.

/** Storage path of the cached single-page PDF, in the private "documents" bucket. */
export function lessonPageCachePath(documentId: string, page: number): string {
  return `lesson-pages/${documentId}/${page}.pdf`;
}

/** Folder holding every cached page of a lesson, removed when the lesson is deleted. */
export function lessonPageCacheFolder(documentId: string): string {
  return `lesson-pages/${documentId}`;
}

/** A page number from a query string, or null when absent or not a positive integer. */
export function parsePage(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

/** Lowercase, no accents, punctuation and runs of spaces collapsed: makes PDF text comparable with the excerpt. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether a text run of the PDF page is part of the quoted excerpt.
 * Short runs ("la", "Elle") would match almost any excerpt, so a run needs at least 3 words or 15 characters.
 */
export function isInExcerpt(runText: string, normalizedExcerpt: string): boolean {
  const run = normalizeText(runText);
  if (!run || !normalizedExcerpt) return false;
  const words = run.split(" ").length;
  if (words < 3 && run.length < 15) return false;
  return ` ${normalizedExcerpt} `.includes(` ${run} `);
}

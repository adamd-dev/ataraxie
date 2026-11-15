import * as claude from "./claude";
import * as meta from "./meta";
import type { ExtractInput, ExtractedQuestion, LessonSelectInput, RegenerateInput } from "./schema";

export type { ExtractedQuestion, SourceDoc, SourcePart } from "./schema";

export type AiProvider = "claude" | "meta";

/**
 * Provider used for imports: AI_PROVIDER if set, otherwise whichever key is configured (Meta first).
 * null means AI import is disabled.
 */
export function activeProvider(): AiProvider | null {
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (wanted === "meta") return process.env.META_API_KEY ? "meta" : null;
  if (wanted === "claude") return process.env.ANTHROPIC_API_KEY ? "claude" : null;
  if (process.env.META_API_KEY) return "meta";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export const providerLabel = (p: AiProvider) => (p === "meta" ? `Meta (${meta.metaModel()})` : "Claude");

function provider(): AiProvider {
  const p = activeProvider();
  if (!p) throw new Error("AI import is disabled: set META_API_KEY or ANTHROPIC_API_KEY (and optionally AI_PROVIDER).");
  return p;
}

/** Largest number of pages one stored part of a lesson PDF may have for this provider. */
export const pagesPerPart = (p: AiProvider) => (p === "meta" ? meta.META_PAGES_PER_PART : claude.CLAUDE_PAGES_PER_PART);

export function uploadPdf(p: AiProvider, bytes: Uint8Array, filename: string): Promise<string> {
  return p === "meta" ? meta.uploadPdf(bytes, filename) : claude.uploadPdf(bytes, filename);
}

export function extractQuestions(input: ExtractInput): Promise<ExtractedQuestion[]> {
  return provider() === "meta" ? meta.extractQuestions(input) : claude.extractQuestions(input);
}

export function regenerateQuestion(input: RegenerateInput): Promise<ExtractedQuestion> {
  return provider() === "meta" ? meta.regenerateQuestion(input) : claude.regenerateQuestion(input);
}

/**
 * Most lesson pages sent with one extract. Meta counts each PDF page as text plus an image (~2.3k tokens),
 * so 250 pages stay well under its 1M-token window; Claude reads at most 600 PDF pages per request.
 */
export const lessonPageBudget = (p: AiProvider) => (p === "meta" ? 250 : 500);

export function selectLessons(input: LessonSelectInput): Promise<number[]> {
  return provider() === "meta" ? meta.selectLessons(input) : claude.selectLessons(input);
}

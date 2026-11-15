import { z } from "zod";
import type { PageChunk } from "@/lib/pdf";

// Shared by every AI provider: output schema, system prompt and per-request instructions.

const ExtractedChoice = z.object({
  label: z.string().describe("Choice letter as printed, e.g. A, B, C"),
  text: z.string(),
  is_correct: z.boolean(),
});

const ExtractedQuestionSchema = z.object({
  number: z.number().int().nullable().describe("Question number as printed, or null"),
  extract_page: z.number().int().describe("1-based page of the provided exam extract where the question starts"),
  statement: z.string(),
  choices: z.array(ExtractedChoice),
  answer_source: z.enum(["corrige", "exam", "ai"]),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string(),
  lesson_excerpt: z.string(),
  lesson_index: z.number().int().nullable().describe("Index N of the 'Cours #N' document the excerpt comes from"),
  lesson_page: z
    .number()
    .int()
    .nullable()
    .describe("Page of the original lesson PDF the excerpt comes from (use the page offset given in the title of a part)"),
  notes: z.string().describe("What the human reviewer should double-check; empty string if nothing"),
});

export const ExtractionResult = z.object({ questions: z.array(ExtractedQuestionSchema) });
export const SingleQuestionResult = z.object({ question: ExtractedQuestionSchema });

export type RawExtractedQuestion = z.infer<typeof ExtractedQuestionSchema>;
export type ExtractedQuestion = RawExtractedQuestion & { exam_page: number };

/** A lesson or answer key already uploaded to the active provider. Large PDFs may be stored as several parts. */
export interface SourceDoc {
  title: string;
  parts: SourcePart[];
}

export interface SourcePart {
  fileId: string;
  firstPage: number;
  lastPage: number;
}

export interface ExtractInput {
  moduleName: string;
  examTitle: string;
  lessons: SourceDoc[];
  corriges: SourceDoc[];
  chunkPdf: Uint8Array;
  chunk: PageChunk;
}

export interface RegenerateInput {
  moduleName: string;
  examTitle: string;
  lessons: SourceDoc[];
  corriges: SourceDoc[];
  pagesPdf: Uint8Array;
  firstPage: number;
  current: unknown;
  feedback: string;
}

export const SYSTEM = `You build revision material for medical students from their faculty's past exams (QCM / multiple-choice, often several correct answers per question).

Sources you receive:
- "Cours #N" documents: the professor's lessons for this module. They are the reference for every answer and explanation.
- Optional "Corrigé" documents: the official answer key.
- An extract of the exam paper.

Rules:
- Copy statements and choices verbatim, in the exam's language. Only fix obvious OCR or typing errors. Never invent a question or a choice.
- When questions share a clinical case (cas clinique), repeat the case text at the start of each of its questions' statements.
- Correct answers, in order of priority:
  1. the Corrigé, if it covers the question → answer_source "corrige";
  2. answers marked on the exam paper itself → answer_source "exam";
  3. otherwise decide from the lessons → answer_source "ai".
- confidence: "high" only when the Corrigé or a lesson passage settles every choice unambiguously. Use "medium" or "low" otherwise, and say why in notes.
- lesson_excerpt: a verbatim passage (1-4 sentences) from the Cours that justifies the correct answers. Set lesson_index and lesson_page to where it comes from. If the lessons do not cover the question, use an empty excerpt, null lesson_index and lesson_page, confidence "low", and say so in notes.
- explanation: short, in the exam's language, addressed to a student: why the correct choices are correct and why each wrong choice is wrong, grounded in the lessons.
- If the Corrigé contradicts the lessons, follow the Corrigé and describe the conflict in notes.`;

/** Title shown to the model for one stored part of a source document. */
export function partTitle(prefix: string, doc: SourceDoc, partIndex: number): string {
  const part = doc.parts[partIndex];
  if (doc.parts.length === 1) return `${prefix}: ${doc.title}`;
  return `${prefix}: ${doc.title} (part ${partIndex + 1}/${doc.parts.length}: pages ${part.firstPage}-${part.lastPage} of the original PDF, so page 1 of this part is page ${part.firstPage})`;
}

export function chunkInstruction(input: Pick<ExtractInput, "moduleName" | "examTitle" | "chunk">): string {
  const { chunk } = input;
  const hasContextPage = chunk.contextStart < chunk.start;
  const firstOwnPage = chunk.start - chunk.contextStart + 1;
  return [
    `Module: ${input.moduleName}. Exam: ${input.examTitle}.`,
    `The exam extract above contains pages ${chunk.contextStart}-${chunk.end} of the original paper.`,
    hasContextPage
      ? `Its page 1 is context only (already processed): extract only questions that START on extract page ${firstOwnPage} or later, but use page 1 to complete a question or clinical case that began there.`
      : `Extract every question that starts in this extract.`,
    `If a question starts here but continues past the last page, extract what is visible and say so in notes.`,
    `Return an empty list if the extract contains no questions (cover page, instructions, answer sheet).`,
  ].join("\n");
}

export function regenerateInstruction(input: Pick<RegenerateInput, "moduleName" | "examTitle" | "firstPage" | "current" | "feedback">): string {
  return [
    `Module: ${input.moduleName}. Exam: ${input.examTitle}.`,
    `The exam extract above starts at page ${input.firstPage} of the original paper.`,
    `Here is a draft extraction of ONE question from it. Re-check it carefully against the exam and the lessons and return the corrected question.`,
    `Draft:\n${JSON.stringify(input.current, null, 2)}`,
    input.feedback ? `Reviewer feedback to address:\n${input.feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Converts extract-relative pages to exam pages and drops questions owned by the previous chunk. */
export function placeInExam(questions: RawExtractedQuestion[], chunk: PageChunk): ExtractedQuestion[] {
  return questions
    .map((q) => ({ ...q, exam_page: chunk.contextStart + q.extract_page - 1 }))
    .filter((q) => q.exam_page >= chunk.start);
}

/** Splits a PDF of `pageCount` pages into 1-indexed inclusive ranges of at most `size` pages. */
export function splitRanges(pageCount: number, size: number): { firstPage: number; lastPage: number }[] {
  if (!Number.isFinite(size) || pageCount <= size) return [{ firstPage: 1, lastPage: Math.max(pageCount, 1) }];
  const ranges = [];
  for (let first = 1; first <= pageCount; first += size) {
    ranges.push({ firstPage: first, lastPage: Math.min(first + size - 1, pageCount) });
  }
  return ranges;
}

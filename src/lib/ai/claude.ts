import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  ExtractionResult,
  SingleQuestionResult,
  SYSTEM,
  chunkInstruction,
  partTitle,
  placeInExam,
  regenerateInstruction,
  type ExtractInput,
  type ExtractedQuestion,
  type RegenerateInput,
  type SourceDoc,
} from "./schema";

const MODEL = "claude-opus-5-5";
// Server-side fallback: if a safety classifier declines (e.g. a false positive on drug doses),
// the API re-runs the request on a recommended fallback model instead of failing the chunk.
const BETAS = ["server-side-fallback-2026-07-01"];
// Claude reads a whole lesson PDF in one document block, so lessons are never split.
export const CLAUDE_PAGES_PER_PART = Infinity;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function contextBlocks(lessons: SourceDoc[], corriges: SourceDoc[]): BetaContentBlockParam[] {
  const docBlock = (prefix: string, doc: SourceDoc, i: number): BetaContentBlockParam => ({
    type: "document",
    source: { type: "file", file_id: doc.parts[i].fileId },
    title: partTitle(prefix, doc, i),
  });
  const blocks: BetaContentBlockParam[] = lessons.flatMap((doc, n) => doc.parts.map((_, i) => docBlock(`Cours #${n}`, doc, i)));
  // Lessons are identical for every chunk of every exam of a module: cache them.
  // The answer key differs per exam, so it goes after the breakpoint.
  const last = blocks.at(-1);
  if (last && last.type === "document") last.cache_control = { type: "ephemeral" };
  for (const doc of corriges) blocks.push(...doc.parts.map((_, i) => docBlock("Corrigé", doc, i)));
  return blocks;
}

function pdfBlock(bytes: Uint8Array, title: string): BetaContentBlockParam {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
    title,
  };
}

function assertComplete(response: { stop_reason: string | null; stop_details?: { category?: string | null } | null }) {
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this extract (category: ${response.stop_details?.category ?? "unknown"}).`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Claude's answer was cut off (max_tokens). Lower PAGES_PER_CHUNK in src/lib/pdf.ts.");
  }
}

export async function uploadPdf(bytes: Uint8Array, filename: string): Promise<string> {
  const file = await anthropic().files.upload({
    file: await toFile(bytes, filename, { type: "application/pdf" }),
  });
  return file.id;
}

export async function extractQuestions(input: ExtractInput): Promise<ExtractedQuestion[]> {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    betas: BETAS,
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(ExtractionResult) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...contextBlocks(input.lessons, input.corriges),
          pdfBlock(input.chunkPdf, `Exam extract: ${input.examTitle}`),
          { type: "text", text: chunkInstruction(input) },
        ],
      },
    ],
  });

  assertComplete(response);
  if (!response.parsed_output) throw new Error("Claude returned output that does not match the schema.");
  return placeInExam(response.parsed_output.questions, input.chunk);
}

/** Re-checks one draft question against its exam page(s), optionally following the reviewer's feedback. */
export async function regenerateQuestion(input: RegenerateInput): Promise<ExtractedQuestion> {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(SingleQuestionResult) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...contextBlocks(input.lessons, input.corriges),
          pdfBlock(input.pagesPdf, `Exam extract: ${input.examTitle}`),
          { type: "text", text: regenerateInstruction(input) },
        ],
      },
    ],
  });

  assertComplete(response);
  if (!response.parsed_output) throw new Error("Claude returned output that does not match the schema.");
  const q = response.parsed_output.question;
  return { ...q, exam_page: input.firstPage + q.extract_page - 1 };
}

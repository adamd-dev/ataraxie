import { z } from "zod";
import {
  LessonChoice,
  selectInstruction,
  type LessonSelectInput,
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

// Meta Model API (dev.meta.ai), Responses endpoint: PDFs by file id, JSON-schema output, automatic prefix caching.
const BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_MODEL = "muse-spark-1.3";
// Meta extracts text from the first 100 pages of each PDF only, so longer lessons are uploaded in parts.
export const META_PAGES_PER_PART = 100;
const MAX_ATTEMPTS = 4;
// USD per 1M tokens (input, cached input, output) for the Standard tier, dev.meta.ai pricing 2026-11.
const PRICES: Record<string, [number, number, number]> = {
  "muse-spark": [1.25, 0.15, 4.25],
  "muse-wonder": [4.0, 0.2, 20.0],
  "muse-ember": [0.1, 0.004, 0.5],
};

function apiKey(): string {
  const key = process.env.META_API_KEY;
  if (!key) throw new Error("Missing environment variable META_API_KEY.");
  return key;
}

export function metaModel(): string {
  const model = process.env.META_MODEL?.trim() || DEFAULT_MODEL;
  // Contributor models let Meta train on the content sent; exam papers and lessons are not ours to give away.
  if (model.includes("contributor")) throw new Error(`META_MODEL "${model}" is a Contributor model; use a Standard one.`);
  return model;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path: string, init: { body: BodyInit; json?: boolean }): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(init.json ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    const text = (await res.text().catch(() => "")).slice(0, 500);
    if (!retryable || attempt >= MAX_ATTEMPTS) throw new Error(`Meta API ${path} failed (HTTP ${res.status}): ${text}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await sleep(backoff + Math.random() * 250);
  }
}

export async function uploadPdf(bytes: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
  const body = (await request("files", { body: form })) as { id?: string };
  if (!body.id) throw new Error("Meta API file upload returned no id.");
  return body.id;
}

/** JSON schema in the form Meta's strict mode accepts: plain object root, no $schema, closed objects. */
export function toMetaSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_file"; file_id: string }
  | { type: "input_file"; filename: string; file_data: string };

function contextParts(lessons: SourceDoc[], corriges: SourceDoc[]): ContentPart[] {
  // Lessons first and in a stable order, so the shared prefix hits Meta's automatic cache across chunks.
  const parts: ContentPart[] = [];
  const add = (prefix: string, doc: SourceDoc) =>
    doc.parts.forEach((p, i) => {
      parts.push({ type: "input_text", text: partTitle(prefix, doc, i) });
      parts.push({ type: "input_file", file_id: p.fileId });
    });
  lessons.forEach((doc) => add(`Cours #${doc.index}`, doc));
  corriges.forEach((doc) => add("Corrigé", doc));
  return parts;
}

function examParts(bytes: Uint8Array, title: string): ContentPart[] {
  return [
    { type: "input_text", text: `Exam extract: ${title}` },
    {
      type: "input_file",
      filename: "exam-extract.pdf",
      file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    },
  ];
}

export interface ResponsesBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/** Text of the assistant message; throws on refusals and truncated answers. */
export function outputText(body: ResponsesBody): string {
  if (body.status === "incomplete") {
    const reason = body.incomplete_details?.reason ?? "unknown";
    throw new Error(
      reason === "max_output_tokens"
        ? "Meta's answer was cut off (max_output_tokens). Lower PAGES_PER_CHUNK in src/lib/pdf.ts."
        : `Meta's answer is incomplete (${reason}).`,
    );
  }
  const content = (body.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  const refusal = content.find((c) => c.type === "refusal");
  if (refusal) throw new Error(`Meta declined this extract: ${refusal.refusal ?? ""}`.trim());
  const text = body.output_text ?? content.filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
  if (!text) throw new Error("Meta returned an empty answer.");
  return text;
}

function logUsage(model: string, label: string, usage: ResponsesBody["usage"]) {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const price = Object.entries(PRICES).find(([prefix]) => model.startsWith(prefix))?.[1] ?? PRICES["muse-spark"];
  const cost = ((input - cached) * price[0] + cached * price[1] + output * price[2]) / 1e6;
  console.info(`[meta] ${label} model=${model} input=${input} cached=${cached} output=${output} cost≈$${cost.toFixed(4)}`);
}

async function respond<T>(
  schema: z.ZodType<T>,
  name: string,
  content: ContentPart[],
  maxOutputTokens: number,
  cacheKey: string,
): Promise<T> {
  const model = metaModel();
  const payload = JSON.stringify({
    model,
    instructions: SYSTEM,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name, schema: toMetaSchema(schema), strict: true } },
    max_output_tokens: maxOutputTokens,
    prompt_cache_key: cacheKey,
    // Hint only: keeps a module's lessons cached across its exams (a cold call costs ~7x a cached one).
    prompt_cache_retention: "24h",
  });
  // Output is schema-constrained; one extra try covers a rare malformed JSON body.
  for (let attempt = 1; ; attempt++) {
    const body = (await request("responses", { body: payload, json: true })) as ResponsesBody;
    logUsage(model, name, body.usage);
    const text = outputText(body);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (attempt < 2) continue;
      throw new Error("Meta returned invalid JSON.");
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    if (attempt >= 2) {
      throw new Error(`Meta returned output that does not match the schema: ${result.error.message.slice(0, 300)}`);
    }
  }
}

// Same lessons ⇒ same key, so Meta routes a module's chunks to the same cache.
const cacheKeyFor = (lessons: SourceDoc[]) =>
  `ataraxie:${lessons.flatMap((d) => d.parts.map((p) => p.fileId)).join(",")}`.slice(0, 200);

export async function extractQuestions(input: ExtractInput): Promise<ExtractedQuestion[]> {
  const result = await respond(
    ExtractionResult,
    "extraction",
    [
      ...contextParts(input.lessons, input.corriges),
      ...examParts(input.chunkPdf, input.examTitle),
      { type: "input_text", text: chunkInstruction(input) },
    ],
    32000,
    cacheKeyFor(input.lessons),
  );
  return placeInExam(result.questions, input.chunk);
}

export async function regenerateQuestion(input: RegenerateInput): Promise<ExtractedQuestion> {
  const result = await respond(
    SingleQuestionResult,
    "question",
    [
      ...contextParts(input.lessons, input.corriges),
      ...examParts(input.pagesPdf, input.examTitle),
      { type: "input_text", text: regenerateInstruction(input) },
    ],
    16000,
    cacheKeyFor(input.lessons),
  );
  const q = result.question;
  return { ...q, exam_page: input.firstPage + q.extract_page - 1 };
}

/** Picks the lessons relevant to an exam extract from their titles (cheap: the lessons themselves are not sent). */
export async function selectLessons(input: LessonSelectInput): Promise<number[]> {
  const result = await respond(
    LessonChoice,
    "lesson_choice",
    [...examParts(input.pagesPdf, input.examTitle), { type: "input_text", text: selectInstruction(input) }],
    4000,
    `ataraxie:select:${input.moduleName}`.slice(0, 200),
  );
  return result.lessons;
}

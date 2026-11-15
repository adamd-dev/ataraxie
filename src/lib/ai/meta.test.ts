import { afterEach, describe, expect, it, vi } from "vitest";
import { metaModel, outputText, toMetaSchema } from "./meta";
import { ExtractionResult, LessonChoice, SingleQuestionResult } from "./schema";

/** Meta strict mode: no allOf/oneOf, every object closed and with all properties required. */
function assertStrictCompatible(node: unknown, path = "$"): void {
  if (Array.isArray(node)) return node.forEach((n, i) => assertStrictCompatible(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  expect(obj.allOf, `${path}.allOf`).toBeUndefined();
  expect(obj.oneOf, `${path}.oneOf`).toBeUndefined();
  if (obj.type === "object") {
    expect(obj.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect([...((obj.required as string[]) ?? [])].sort(), `${path}.required`).toEqual(
      Object.keys((obj.properties as object) ?? {}).sort(),
    );
  }
  Object.entries(obj).forEach(([k, v]) => assertStrictCompatible(v, `${path}.${k}`));
}

describe("toMetaSchema", () => {
  it.each([
    ["extraction", ExtractionResult],
    ["question", SingleQuestionResult],
    ["lesson choice", LessonChoice],
  ])("produces a strict-compatible %s schema", (_, schema) => {
    const json = toMetaSchema(schema);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    assertStrictCompatible(json);
  });
});

describe("outputText", () => {
  it("joins the output_text parts of the message", () => {
    const body = {
      status: "completed",
      output: [
        { type: "reasoning" },
        { type: "message", content: [{ type: "output_text", text: '{"questions":' }, { type: "output_text", text: "[]}" }] },
      ],
    };
    expect(outputText(body)).toBe('{"questions":[]}');
  });

  it("reports a truncated answer", () => {
    expect(() => outputText({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toThrow(
      /PAGES_PER_CHUNK/,
    );
  });

  it("reports a refusal", () => {
    expect(() =>
      outputText({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
    ).toThrow(/declined/);
  });
});

describe("metaModel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to muse-spark-1.3", () => {
    vi.stubEnv("META_MODEL", "");
    expect(metaModel()).toBe("muse-spark-1.3");
  });

  it("refuses Contributor models", () => {
    vi.stubEnv("META_MODEL", "muse-spark-1.3-contributor");
    expect(() => metaModel()).toThrow(/Contributor/);
  });
});

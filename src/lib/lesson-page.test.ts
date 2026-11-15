import { describe, expect, it } from "vitest";
import { isInExcerpt, lessonPageCachePath, normalizeText, parsePage } from "./lesson-page";

describe("parsePage", () => {
  it("accepts positive integers only", () => {
    expect(parsePage("42")).toBe(42);
    expect(parsePage("0")).toBeNull();
    expect(parsePage("-3")).toBeNull();
    expect(parsePage("4.5")).toBeNull();
    expect(parsePage("../1")).toBeNull();
    expect(parsePage(null)).toBeNull();
  });
});

describe("lessonPageCachePath", () => {
  it("keeps one file per lesson page", () => {
    expect(lessonPageCachePath("doc-1", 7)).toBe("lesson-pages/doc-1/7.pdf");
  });
});

describe("normalizeText", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalizeText("  Contre-indiquée,  en cas de BAV ! ")).toBe("contre indiquee en cas de bav");
  });
});

describe("isInExcerpt", () => {
  const excerpt = normalizeText(
    "La digoxine est contre-indiquée en cas de bloc auriculo-ventriculaire de haut degré. Elle augmente la force de contraction.",
  );

  it("highlights a run of the quoted passage", () => {
    expect(isInExcerpt("contre-indiquée en cas de bloc", excerpt)).toBe(true);
  });

  it("ignores short runs that would match anywhere", () => {
    expect(isInExcerpt("Elle", excerpt)).toBe(false);
    expect(isInExcerpt("de haut", excerpt)).toBe(false);
  });

  it("does not match text that is not in the passage", () => {
    expect(isInExcerpt("Les bêtabloquants sont indiqués", excerpt)).toBe(false);
  });

  it("only matches whole words", () => {
    expect(isInExcerpt("igoxine est contre", excerpt)).toBe(false);
  });
});

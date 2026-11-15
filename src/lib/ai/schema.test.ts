import { describe, expect, it } from "vitest";
import { partTitle, placeInExam, splitRanges, type RawExtractedQuestion, type SourceDoc } from "./schema";

const q = (extract_page: number): RawExtractedQuestion => ({
  number: 1,
  extract_page,
  statement: "s",
  choices: [],
  answer_source: "ai",
  confidence: "low",
  explanation: "",
  lesson_excerpt: "",
  lesson_index: null,
  lesson_page: null,
  notes: "",
});

describe("splitRanges", () => {
  it("keeps a short PDF in one part", () => {
    expect(splitRanges(80, 100)).toEqual([{ firstPage: 1, lastPage: 80 }]);
  });

  it("never splits when the provider has no page limit", () => {
    expect(splitRanges(500, Infinity)).toEqual([{ firstPage: 1, lastPage: 500 }]);
  });

  it("splits a long PDF into parts of at most `size` pages", () => {
    expect(splitRanges(230, 100)).toEqual([
      { firstPage: 1, lastPage: 100 },
      { firstPage: 101, lastPage: 200 },
      { firstPage: 201, lastPage: 230 },
    ]);
  });
});

describe("placeInExam", () => {
  it("maps extract pages to exam pages and drops questions of the context page", () => {
    const placed = placeInExam([q(1), q(2), q(3)], { start: 3, end: 4, contextStart: 2 });
    expect(placed.map((p) => p.exam_page)).toEqual([3, 4]);
  });
});

describe("partTitle", () => {
  it("gives the page offset only for multi-part documents", () => {
    const one: SourceDoc = { title: "Cardio", parts: [{ fileId: "a", firstPage: 1, lastPage: 50 }] };
    const two: SourceDoc = {
      title: "Cardio",
      parts: [
        { fileId: "a", firstPage: 1, lastPage: 100 },
        { fileId: "b", firstPage: 101, lastPage: 150 },
      ],
    };
    expect(partTitle("Cours #0", one, 0)).toBe("Cours #0: Cardio");
    expect(partTitle("Cours #0", two, 1)).toContain("page 1 of this part is page 101");
  });
});

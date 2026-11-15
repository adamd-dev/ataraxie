import { describe, expect, it } from "vitest";
import { budgetLessons, partTitle, placeInExam, selectInstruction, splitRanges, type RawExtractedQuestion, type SourceDoc } from "./schema";

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
    const one: SourceDoc = { index: 0, title: "Cardio", parts: [{ fileId: "a", firstPage: 1, lastPage: 50 }] };
    const two: SourceDoc = {
      index: 0,
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

describe("budgetLessons", () => {
  const lessons = [
    { index: 0, pages: 40 },
    { index: 1, pages: 120 },
    { index: 2, pages: 30 },
    { index: 3, pages: 300 },
  ];

  it("keeps the model's order and drops lessons that do not fit", () => {
    expect(budgetLessons([2, 1, 0], lessons, 160)).toEqual([2, 1]);
  });

  it("skips one oversized lesson but keeps later ones that fit", () => {
    expect(budgetLessons([0, 3, 2], lessons, 100)).toEqual([0, 2]);
  });

  it("always keeps the first choice, even alone over budget", () => {
    expect(budgetLessons([3], lessons, 250)).toEqual([3]);
  });

  it("ignores unknown and repeated indices", () => {
    expect(budgetLessons([9, 0, 0, 2], lessons, 500)).toEqual([0, 2]);
  });
});

describe("selectInstruction", () => {
  it("lists lessons with their module-wide Cours number", () => {
    const text = selectInstruction({
      moduleName: "Dermatologie",
      examTitle: "CPC 2026",
      lessons: [{ index: 4, title: "05 Le Mélanome", pages: 32 }],
    });
    expect(text).toContain("- Cours #4: 05 Le Mélanome (32 pages)");
  });
});

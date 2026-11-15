import { NextResponse } from "next/server";
import { getUser, isAdmin } from "@/lib/auth";
import { downloadDocument } from "@/lib/import/run-step";
import { lessonPageCachePath, parsePage } from "@/lib/lesson-page";
import { countPages, extractPages } from "@/lib/pdf";
import { createServiceClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/lib/types";

export const maxDuration = 60;

const notFound = (message: string) => NextResponse.json({ error: message }, { status: 404 });

/**
 * One page of the lesson PDF that justifies a question's answer, as a one-page PDF.
 * Students: logged in, approved questions only, the stored page only. The rest of the lesson stays private.
 * Admins: any question, and `?page=N` to preview another page while correcting the reference.
 */
export async function GET(request: Request, { params }: { params: Promise<{ questionId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = await isAdmin(user.id);
  const { questionId } = await params;

  const db = createServiceClient();
  const { data: question } = await db
    .from("questions")
    .select("status, lesson_document_id, lesson_page")
    .eq("id", questionId)
    .maybeSingle();
  if (!question || (!admin && question.status !== "approved")) return notFound("Question not found");

  const override = admin ? parsePage(new URL(request.url).searchParams.get("page")) : null;
  const page = override ?? question.lesson_page;
  if (!question.lesson_document_id || !page) return notFound("No lesson page for this question");

  const { data: docData } = await db.from("documents").select("*").eq("id", question.lesson_document_id).maybeSingle();
  const doc = docData as DocumentRow | null;
  if (!doc || doc.kind !== "cours") return notFound("Lesson not found");
  if (doc.page_count && page > doc.page_count) return notFound(`The lesson has ${doc.page_count} pages`);

  try {
    const cachePath = lessonPageCachePath(doc.id, page);
    const cached = await db.storage.from("documents").download(cachePath);
    let bytes: Uint8Array;
    if (cached.data) {
      bytes = new Uint8Array(await cached.data.arrayBuffer());
    } else {
      const lesson = await downloadDocument(db, doc);
      const pageCount = doc.page_count ?? (await countPages(lesson));
      if (page > pageCount) return notFound(`The lesson has ${pageCount} pages`);
      bytes = await extractPages(lesson, page, page);
      // Cache so the next student does not download the whole lesson again. Best effort.
      await db.storage.from("documents").upload(cachePath, bytes, { contentType: "application/pdf", upsert: true });
    }
    return new NextResponse(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="cours-p${page}.pdf"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

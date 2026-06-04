import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  const canAnswer =
    user?.role === "admin" ||
    question.assignedToId === session.user.id ||
    question.assignedToId === null;

  // 質問者自身は回答できない（自分の質問には回答しない）
  if (question.authorId === session.user.id) {
    return NextResponse.json({ error: "自分の質問には回答できません" }, { status: 403 });
  }

  if (!canAnswer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { content, imageData } = await req.json();
  const answer = await prisma.answer.create({
    data: {
      content: content || "",
      imageData: imageData || null,
      authorId: session.user.id,
      questionId: id,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  await prisma.question.update({ where: { id }, data: { status: "answered", updatedAt: new Date() } });

  return NextResponse.json(answer);
}

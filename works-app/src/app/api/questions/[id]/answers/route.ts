import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (question.authorId === session.user.id) {
    return NextResponse.json({ error: "自分の質問には回答できません" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  const canAnswer =
    user?.role === "admin" ||
    question.assignedToId === session.user.id ||
    question.assignedToId === null;
  if (!canAnswer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { content, imageData } = await req.json();
  const answer = await prisma.answer.create({
    data: { content: content || "", imageData: imageData || null, authorId: session.user.id, questionId: id },
    include: { author: { select: { id: true, name: true } } },
  });

  await prisma.question.update({ where: { id }, data: { status: "answered", updatedAt: new Date() } });

  // 質問者に通知
  await sendPushToUsers([question.authorId], {
    title: `✅ 質問に回答が届きました`,
    body: content || "画像が添付されています",
    url: "/qa",
  });

  return NextResponse.json(answer);
}

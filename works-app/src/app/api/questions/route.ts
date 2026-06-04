import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const isAdmin = user?.role === "admin";

  // 自分が書いた質問 + 自分に割り当てられた質問 + 割り当てなしの質問（誰でも回答可）
  const questions = await prisma.question.findMany({
    where: isAdmin ? undefined : {
      OR: [
        { authorId: userId },
        { assignedToId: userId },
        { assignedToId: null, status: "open" },
      ],
    },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      assignedTo: { select: { id: true, name: true } },
      // 回答は質問者 or 管理者にのみ返す（回答者は内容を見せない）
      answers: userId ? {
        where: isAdmin ? undefined : { question: { authorId: userId } },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      } : false,
      _count: { select: { answers: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // 回答者には回答内容を隠す（自分が書いた質問でない場合）
  const result = questions.map(q => ({
    ...q,
    answers: q.authorId === userId || isAdmin ? q.answers : [],
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, assignedToId, isAnonymous } = await req.json();
  const question = await prisma.question.create({
    data: {
      content,
      authorId: session.user.id,
      assignedToId: assignedToId || null,
      isAnonymous: isAnonymous ?? false,
    },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      assignedTo: { select: { id: true, name: true } },
      answers: { include: { author: { select: { id: true, name: true } } } },
      _count: { select: { answers: true } },
    },
  });
  return NextResponse.json(question);
}

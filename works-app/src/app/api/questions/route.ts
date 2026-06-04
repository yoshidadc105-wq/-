import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const isAdmin = user?.role === "admin";

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
      answers: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { answers: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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

  // 指名ありは指名した人、なしは全員に通知
  const authorName = isAnonymous ? "匿名" : question.author.name;
  if (assignedToId) {
    await sendPushToUsers([assignedToId], {
      title: `❓ ${authorName}から質問が届きました`,
      body: content,
      url: "/qa",
    });
  } else {
    const allUsers = await prisma.user.findMany({
      where: { id: { not: session.user.id } },
      select: { id: true },
    });
    await sendPushToUsers(allUsers.map(u => u.id), {
      title: `❓ 新しい質問があります`,
      body: content,
      url: "/qa",
    });
  }

  return NextResponse.json(question);
}

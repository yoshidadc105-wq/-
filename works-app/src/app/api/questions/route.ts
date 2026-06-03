import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  // Users can see: their own questions, questions assigned to them, and questions they've answered
  const questions = await prisma.question.findMany({
    where: {
      OR: [
        { authorId: userId },
        { assignedToId: userId },
        { answers: { some: { authorId: userId } } },
        // Admins see all - handled below
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

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "admin") {
    const allQuestions = await prisma.question.findMany({
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
    return NextResponse.json(allQuestions);
  }

  // For non-admins: also show questions with no assignee (open to anyone)
  const openQuestions = await prisma.question.findMany({
    where: {
      assignedToId: null,
      authorId: { not: userId },
      status: "open",
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

  const combined = [...questions, ...openQuestions.filter(q => !questions.find(q2 => q2.id === q.id))];
  return NextResponse.json(combined);
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

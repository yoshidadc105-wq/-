import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { emoji } = await req.json();

  // Toggle: remove if exists, add if not
  const existing = await prisma.messageReaction.findUnique({
    where: { userId_messageId_emoji: { userId: session.user.id, messageId: id, emoji } },
  });

  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.create({
      data: { emoji, userId: session.user.id, messageId: id },
    });
  }

  const reactions = await prisma.messageReaction.findMany({
    where: { messageId: id },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json(reactions);
}

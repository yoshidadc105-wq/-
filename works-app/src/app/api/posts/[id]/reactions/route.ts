import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { emoji } = await req.json();

  const existing = await prisma.postReaction.findUnique({
    where: { userId_postId_emoji: { userId: session.user.id, postId: id, emoji } },
  });

  if (existing) {
    await prisma.postReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.postReaction.create({
      data: { emoji, userId: session.user.id, postId: id },
    });
  }

  const reactions = await prisma.postReaction.findMany({
    where: { postId: id },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json(reactions);
}

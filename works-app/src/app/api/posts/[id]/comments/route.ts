import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { content } = await req.json();
  const comment = await prisma.comment.create({
    data: { content, authorId: session.user.id, postId: id },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json(comment);
}

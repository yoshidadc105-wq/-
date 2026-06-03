import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const posts = await prisma.post.findMany({
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      files: true,
      _count: { select: { comments: true } },
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(posts);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, content } = await req.json();
  const post = await prisma.post.create({
    data: { title, content, authorId: session.user.id },
    include: {
      author: { select: { id: true, name: true, avatar: true } },
      comments: { include: { author: { select: { id: true, name: true } } } },
      files: true,
      _count: { select: { comments: true } },
    },
  });
  return NextResponse.json(post);
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (message.senderId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // 送信から5分以内のみ取り消し可能
  const elapsed = Date.now() - new Date(message.createdAt).getTime();
  if (elapsed > 5 * 60 * 1000) {
    return NextResponse.json({ error: "送信から5分以上経過しているため取り消しできません" }, { status: 400 });
  }

  await prisma.messageReaction.deleteMany({ where: { messageId: id } });
  await prisma.message.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

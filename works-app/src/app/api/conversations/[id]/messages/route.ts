import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const member = await prisma.conversationMember.findFirst({
    where: { conversationId: id, userId: session.user.id },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.conversationMember.update({
    where: { id: member.id },
    data: { lastReadAt: new Date() },
  });

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: {
      sender: { select: { id: true, name: true, avatar: true } },
      files: true,
      reactions: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(messages);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const members = await prisma.conversationMember.findMany({
    where: { conversationId: id },
  });
  const memberIds = members.map(m => m.userId);
  if (!memberIds.includes(session.user.id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { content, imageData } = await req.json();
  const message = await prisma.message.create({
    data: {
      content: content || "",
      imageData: imageData || null,
      senderId: session.user.id,
      conversationId: id,
    },
    include: {
      sender: { select: { id: true, name: true, avatar: true } },
      files: true,
      reactions: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });

  // 自分以外のメンバーに通知
  const otherIds = memberIds.filter(uid => uid !== session.user.id);
  await sendPushToUsers(otherIds, {
    title: `💬 ${message.sender.name}`,
    body: imageData?.startsWith("data:video/") ? "🎥 動画を送信しました" : imageData ? "📷 画像を送信しました" : (content || ""),
    url: "/chat",
  });

  return NextResponse.json(message);
}

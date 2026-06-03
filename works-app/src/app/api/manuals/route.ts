import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manuals = await prisma.manualLink.findMany({
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ category: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(manuals);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, url, description, category } = await req.json();
  const manual = await prisma.manualLink.create({
    data: { title, url, description, category: category || "general", createdById: session.user.id },
    include: { createdBy: { select: { name: true } } },
  });
  return NextResponse.json(manual);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  const manual = await prisma.manualLink.findUnique({ where: { id } });
  if (!manual) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (manual.createdById !== session.user.id && user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.manualLink.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

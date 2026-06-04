import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NotificationSetup from "@/components/NotificationSetup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {/* pt-14 on mobile for the fixed top bar */}
      <main className="flex-1 overflow-hidden pt-14 md:pt-0">{children}</main>
      <NotificationSetup />
    </div>
  );
}

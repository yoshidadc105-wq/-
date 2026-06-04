"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";

const navItems = [
  { href: "/chat", icon: "💬", label: "チャット" },
  { href: "/board", icon: "📋", label: "掲示板" },
  { href: "/qa", icon: "❓", label: "Q&A" },
  { href: "/manuals", icon: "📚", label: "マニュアル" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-gray-900 text-white flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-sm">W</div>
          <span className="font-semibold text-sm">Works</span>
        </div>
        <button onClick={() => setOpen(!open)} className="text-white text-xl p-1">
          {open ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-20 bg-black/50" onClick={() => setOpen(false)} />
      )}

      {/* Mobile drawer / Desktop sidebar */}
      <aside className={`
        fixed md:static top-0 left-0 h-full z-20
        w-64 bg-gray-900 text-white flex flex-col
        transition-transform duration-200
        ${open ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0
      `}>
        {/* Desktop header */}
        <div className="hidden md:flex p-4 border-b border-gray-700 items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-sm">W</div>
          <span className="font-semibold text-sm">Works</span>
        </div>

        {/* Spacer for mobile top bar */}
        <div className="md:hidden h-14" />

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
                pathname.startsWith(item.href)
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-700">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 bg-indigo-400 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
              {session?.user?.name?.[0] ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session?.user?.name}</p>
              <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-gray-500 hover:text-white text-xs"
              title="ログアウト"
            >
              ↩
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

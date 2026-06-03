"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface Manual {
  id: string;
  title: string;
  url: string;
  description?: string;
  category: string;
  createdAt: string;
  createdBy: { name: string };
}

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  general: { label: "一般", icon: "📄" },
  hr: { label: "人事・労務", icon: "👥" },
  it: { label: "IT・システム", icon: "💻" },
  sales: { label: "営業", icon: "📊" },
  operations: { label: "業務手順", icon: "⚙️" },
};

export default function ManualsPage() {
  const { data: session } = useSession();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", description: "", category: "general" });
  const [filter, setFilter] = useState("all");

  useEffect(() => { fetchManuals(); }, []);

  async function fetchManuals() {
    const res = await fetch("/api/manuals");
    if (res.ok) setManuals(await res.json());
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/manuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ title: "", url: "", description: "", category: "general" });
      setShowForm(false);
      fetchManuals();
    }
  }

  async function deleteManual(id: string) {
    if (!confirm("このリンクを削除しますか？")) return;
    await fetch("/api/manuals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchManuals();
  }

  const filtered = filter === "all" ? manuals : manuals.filter(m => m.category === filter);
  const grouped = filtered.reduce<Record<string, Manual[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">マニュアル・リンク集</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + リンクを追加
          </button>
        </div>

        {showForm && (
          <form onSubmit={addManual} className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-4">リンクを追加</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">タイトル</label>
                <input
                  required
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="就業規則"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                <input
                  required
                  type="url"
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
                <select
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {Object.entries(CATEGORIES).map(([v, { label }]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
                <input
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="概要を入力..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">追加</button>
            </div>
          </form>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === "all" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"}`}
          >
            すべて
          </button>
          {Object.entries(CATEGORIES).map(([v, { label, icon }]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filter === v ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"}`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {Object.keys(grouped).length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-4">📚</p>
            <p>まだリンクが登録されていません</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([cat, items]) => {
              const catInfo = CATEGORIES[cat] ?? { label: cat, icon: "📄" };
              return (
                <div key={cat}>
                  <h2 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                    <span>{catInfo.icon}</span>
                    <span>{catInfo.label}</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {items.map(m => (
                      <a
                        key={m.id}
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all group block"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors text-sm truncate">
                              🔗 {m.title}
                            </h3>
                            {m.description && (
                              <p className="text-xs text-gray-500 mt-1 truncate">{m.description}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-2">{m.createdBy.name}</p>
                          </div>
                          <button
                            onClick={e => { e.preventDefault(); deleteManual(m.id); }}
                            className="text-gray-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          >
                            🗑
                          </button>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

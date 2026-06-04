"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface Manual {
  id: string; title: string; url: string; description?: string;
  createdAt: string; createdBy: { name: string };
}

export default function ManualsPage() {
  const { data: session } = useSession();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", description: "" });

  useEffect(() => { fetchManuals(); }, []);

  async function fetchManuals() {
    const res = await fetch("/api/manuals");
    if (res.ok) setManuals(await res.json());
  }

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/manuals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ title: "", url: "", description: "" });
      setShowForm(false); fetchManuals();
    }
  }

  async function deleteManual(id: string) {
    if (!confirm("このリンクを削除しますか？")) return;
    await fetch("/api/manuals", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchManuals();
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">📚 マニュアル・リンク集</h1>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + 追加
          </button>
        </div>

        {showForm && (
          <form onSubmit={addManual} className="bg-white rounded-xl shadow-sm p-5 mb-5 border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-4">リンクを追加</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">タイトル</label>
                <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="就業規則" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                <input required type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="概要を入力..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">追加</button>
            </div>
          </form>
        )}

        {manuals.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-4">📚</p>
            <p>まだリンクが登録されていません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {manuals.map(m => (
              <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all group flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-xl flex-shrink-0">🔗</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors text-sm">{m.title}</p>
                  {m.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{m.description}</p>}
                </div>
                <button onClick={e => { e.preventDefault(); deleteManual(m.id); }}
                  className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1">
                  🗑
                </button>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

interface User { id: string; name: string; }
interface Answer { id: string; content: string; imageData?: string; createdAt: string; author: { id: string; name: string }; }
interface Question {
  id: string; content: string; status: string; isAnonymous: boolean; createdAt: string;
  author: { id: string; name: string };
  assignedTo: User | null;
  answers: Answer[];
  _count: { answers: number };
}

export default function QAPage() {
  const { data: session } = useSession();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ content: "", assignedToId: "", isAnonymous: false });
  const [answerForms, setAnswerForms] = useState<Record<string, { content: string; imageData: string }>>({});
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const answerFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { fetchQuestions(); fetchUsers(); }, []);

  async function fetchQuestions() {
    const res = await fetch("/api/questions");
    if (res.ok) setQuestions(await res.json());
  }
  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }

  async function submitQuestion(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/questions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ content: "", assignedToId: "", isAnonymous: false });
      setShowForm(false); fetchQuestions();
    }
  }

  async function submitAnswer(questionId: string) {
    const af = answerForms[questionId];
    if (!af?.content?.trim() && !af?.imageData) return;
    const res = await fetch(`/api/questions/${questionId}/answers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: af?.content || "", imageData: af?.imageData || null }),
    });
    if (res.ok) {
      setAnswerForms(prev => ({ ...prev, [questionId]: { content: "", imageData: "" } }));
      fetchQuestions();
    }
  }

  function handleAnswerImage(questionId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("画像は5MB以下にしてください"); return; }
    const reader = new FileReader();
    reader.onload = () => setAnswerForms(prev => ({ ...prev, [questionId]: { ...prev[questionId], imageData: reader.result as string } }));
    reader.readAsDataURL(file);
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function statusBadge(status: string) {
    if (status === "answered") return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✅ 回答済み</span>;
    return <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">⏳ 回答待ち</span>;
  }

  const myQuestions = questions.filter(q => q.author.id === session?.user?.id);
  const toAnswerQuestions = questions.filter(q => q.author.id !== session?.user?.id);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Q&Aボード</h1>
            <p className="text-xs text-gray-500 mt-0.5">回答は質問した本人のみ確認できます</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + 質問する
          </button>
        </div>

        {showForm && (
          <form onSubmit={submitQuestion} className="bg-white rounded-xl shadow-sm p-5 my-4 border border-indigo-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🔒</span>
              <h2 className="font-semibold text-gray-800">質問を投稿</h2>
            </div>
            <p className="text-xs text-blue-600 bg-blue-50 rounded-lg p-3 mb-3">
              回答は質問した本人にしか表示されません。聞きにくいことも安心して質問できます。
            </p>
            <textarea required value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="質問内容を入力..." rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">回答者を指名（任意）</label>
              <select value={form.assignedToId} onChange={e => setForm({ ...form, assignedToId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">指名しない（誰でも回答可）</option>
                {users.filter(u => u.id !== session?.user?.id).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 mb-4 cursor-pointer">
              <input type="checkbox" checked={form.isAnonymous} onChange={e => setForm({ ...form, isAnonymous: e.target.checked })} className="rounded" />
              匿名で投稿（回答者に名前が表示されません）
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">投稿する</button>
            </div>
          </form>
        )}

        {/* 自分の質問 */}
        {myQuestions.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-1">📝 自分の質問</h2>
            <div className="space-y-3">
              {myQuestions.map(q => (
                <div key={q.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{q.content}</p>
                      {statusBadge(q.status)}
                    </div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-gray-500">
                      <span>{formatDate(q.createdAt)}</span>
                      {q.assignedTo && <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">→ {q.assignedTo.name} に依頼</span>}
                      <span className="text-gray-400">回答 {q._count.answers}件</span>
                    </div>
                  </div>

                  {/* 自分の質問への回答表示 */}
                  {q.answers.length > 0 && (
                    <div className="border-t border-gray-100 bg-green-50 px-4 py-3 space-y-3">
                      <p className="text-xs font-semibold text-green-700">💬 回答（あなただけに表示）</p>
                      {q.answers.map(a => (
                        <div key={a.id} className="flex gap-2">
                          <div className="w-7 h-7 bg-green-200 rounded-full flex items-center justify-center text-xs font-bold text-green-700 flex-shrink-0">{a.author.name[0]}</div>
                          <div className="flex-1 bg-white rounded-xl px-3 py-2 shadow-sm">
                            <p className="text-xs font-semibold text-green-700 mb-1">{a.author.name}</p>
                            {a.content && <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.content}</p>}
                            {a.imageData && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.imageData} alt="回答画像" className="mt-2 max-h-48 rounded-lg cursor-pointer border border-gray-200" onClick={() => setPreviewImage(a.imageData!)} />
                            )}
                            <p className="text-xs text-gray-400 mt-1">{formatDate(a.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {q._count.answers === 0 && (
                    <div className="border-t border-gray-100 px-4 py-3 text-center text-xs text-gray-400">
                      まだ回答がありません。お待ちください...
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 回答できる質問 */}
        {toAnswerQuestions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-1">💬 回答できる質問</h2>
            <div className="space-y-3">
              {toAnswerQuestions.map(q => {
                const af = answerForms[q.id] ?? { content: "", imageData: "" };
                const isOpen = expandedQ === q.id;
                return (
                  <div key={q.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{q.content}</p>
                        {statusBadge(q.status)}
                      </div>
                      <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-gray-500">
                        <span>{q.isAnonymous ? "匿名" : q.author.name}</span>
                        <span>{formatDate(q.createdAt)}</span>
                        {q.assignedTo && <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">→ {q.assignedTo.name} に依頼</span>}
                      </div>
                    </div>

                    {/* 回答フォーム */}
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                      {!isOpen ? (
                        <button onClick={() => setExpandedQ(q.id)}
                          className="w-full flex items-center justify-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors border border-indigo-200 bg-white">
                          ✏️ この質問に回答する
                        </button>
                      ) : (
                        <div>
                          <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                            <span>🔒</span> 回答内容は質問者のみに表示されます
                          </p>
                          <textarea
                            value={af.content}
                            onChange={e => setAnswerForms(prev => ({ ...prev, [q.id]: { ...af, content: e.target.value } }))}
                            placeholder="回答を入力..."
                            rows={3}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          {/* Image attachment */}
                          <div className="mb-2">
                            <button type="button" onClick={() => answerFileRefs.current[q.id]?.click()}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 border border-dashed border-gray-300 rounded-lg px-3 py-1.5">
                              📷 画像を添付
                            </button>
                            <input
                              ref={el => { answerFileRefs.current[q.id] = el; }}
                              type="file" accept="image/*"
                              onChange={e => handleAnswerImage(q.id, e)}
                              className="hidden"
                            />
                            {af.imageData && (
                              <div className="mt-2 relative inline-block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={af.imageData} alt="preview" className="max-h-28 rounded-lg border border-gray-200" />
                                <button onClick={() => setAnswerForms(prev => ({ ...prev, [q.id]: { ...af, imageData: "" } }))}
                                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setExpandedQ(null)} className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">キャンセル</button>
                            <button onClick={() => submitAnswer(q.id)}
                              disabled={!af.content.trim() && !af.imageData}
                              className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium">
                              回答を送信
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {questions.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-4">❓</p>
            <p className="font-medium">まだ質問がありません</p>
            <p className="text-sm mt-1">+質問するボタンから投稿できます</p>
          </div>
        )}
      </div>

      {/* Image full preview */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewImage} alt="フルサイズ" className="max-w-full max-h-full rounded-lg" />
          <button className="absolute top-4 right-4 text-white text-2xl">✕</button>
        </div>
      )}
    </div>
  );
}

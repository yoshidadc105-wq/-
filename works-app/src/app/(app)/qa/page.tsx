"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface User { id: string; name: string; }
interface Answer { id: string; content: string; createdAt: string; author: { id: string; name: string }; }
interface Question {
  id: string;
  content: string;
  status: string;
  isAnonymous: boolean;
  createdAt: string;
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
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchQuestions();
    fetchUsers();
  }, []);

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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ content: "", assignedToId: "", isAnonymous: false });
      setShowForm(false);
      fetchQuestions();
    }
  }

  async function submitAnswer(questionId: string) {
    const content = answerText[questionId];
    if (!content?.trim()) return;
    const res = await fetch(`/api/questions/${questionId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setAnswerText({ ...answerText, [questionId]: "" });
      fetchQuestions();
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function statusBadge(status: string) {
    if (status === "answered") return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">回答済み</span>;
    if (status === "closed") return <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">クローズ</span>;
    return <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">回答待ち</span>;
  }

  const myQuestions = questions.filter(q => q.author.id === session?.user?.id);
  const otherQuestions = questions.filter(q => q.author.id !== session?.user?.id);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Q&Aボード</h1>
            <p className="text-sm text-gray-500 mt-1">質問は指名した相手か、誰でも回答できます。内容は関係者のみ閲覧可能です。</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + 質問する
          </button>
        </div>

        {showForm && (
          <form onSubmit={submitQuestion} className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-indigo-200">
            <h2 className="font-semibold text-gray-800 mb-4">🔒 質問を投稿</h2>
            <p className="text-xs text-gray-500 mb-3 bg-blue-50 rounded-lg p-3">
              投稿した質問は、回答者・指名した相手・管理者のみに表示されます。
            </p>
            <textarea
              required
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="質問内容を入力..."
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">回答者を指名（任意）</label>
              <select
                value={form.assignedToId}
                onChange={e => setForm({ ...form, assignedToId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">指名しない（誰でも回答可）</option>
                {users.filter(u => u.id !== session?.user?.id).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 mb-4">
              <input
                type="checkbox"
                checked={form.isAnonymous}
                onChange={e => setForm({ ...form, isAnonymous: e.target.checked })}
                className="rounded"
              />
              匿名で投稿（回答者には名前が表示されません）
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">投稿</button>
            </div>
          </form>
        )}

        {myQuestions.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
              <span>📝 自分の質問</span>
            </h2>
            <QList questions={myQuestions} session={session} expandedQ={expandedQ} setExpandedQ={setExpandedQ}
              answerText={answerText} setAnswerText={setAnswerText} submitAnswer={submitAnswer}
              statusBadge={statusBadge} formatDate={formatDate} />
          </div>
        )}

        {otherQuestions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-600 mb-3">💬 回答できる質問</h2>
            <QList questions={otherQuestions} session={session} expandedQ={expandedQ} setExpandedQ={setExpandedQ}
              answerText={answerText} setAnswerText={setAnswerText} submitAnswer={submitAnswer}
              statusBadge={statusBadge} formatDate={formatDate} />
          </div>
        )}

        {questions.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-4">❓</p>
            <p>まだ質問がありません</p>
          </div>
        )}
      </div>
    </div>
  );
}

function QList({ questions, session, expandedQ, setExpandedQ, answerText, setAnswerText, submitAnswer, statusBadge, formatDate }: {
  questions: Question[]; session: ReturnType<typeof useSession>["data"]; expandedQ: string | null;
  setExpandedQ: (id: string | null) => void; answerText: Record<string, string>;
  setAnswerText: (v: Record<string, string>) => void; submitAnswer: (id: string) => void;
  statusBadge: (s: string) => React.ReactNode; formatDate: (d: string) => string;
}) {
  return (
    <div className="space-y-3">
      {questions.map(q => (
        <div key={q.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <p className="text-gray-800 text-sm whitespace-pre-wrap flex-1">{q.content}</p>
              {statusBadge(q.status)}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>
                {q.isAnonymous && q.author.id !== session?.user?.id ? "匿名" : q.author.name}
              </span>
              <span>{formatDate(q.createdAt)}</span>
              {q.assignedTo && (
                <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                  → {q.assignedTo.name} に依頼
                </span>
              )}
              <button
                onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                className="ml-auto text-gray-400 hover:text-indigo-600"
              >
                回答 {q._count.answers}件 {expandedQ === q.id ? "▲" : "▼"}
              </button>
            </div>
          </div>

          {expandedQ === q.id && (
            <div className="border-t border-gray-100 px-5 pb-5">
              <div className="mt-4 space-y-3">
                {q.answers.map(a => (
                  <div key={a.id} className="flex gap-2">
                    <div className="w-7 h-7 bg-green-200 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-green-700">
                      {a.author.name[0]}
                    </div>
                    <div className="flex-1 bg-green-50 rounded-lg px-3 py-2">
                      <p className="text-xs font-medium text-green-700">{a.author.name}</p>
                      <p className="text-sm text-gray-700 mt-0.5">{a.content}</p>
                    </div>
                  </div>
                ))}
              </div>
              {q.author.id !== session?.user?.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={answerText[q.id] ?? ""}
                    onChange={e => setAnswerText({ ...answerText, [q.id]: e.target.value })}
                    placeholder="回答を入力..."
                    className="flex-1 border border-gray-300 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    onKeyDown={e => { if (e.key === "Enter") submitAnswer(q.id); }}
                  />
                  <button
                    onClick={() => submitAnswer(q.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-full hover:bg-green-700"
                  >
                    回答
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

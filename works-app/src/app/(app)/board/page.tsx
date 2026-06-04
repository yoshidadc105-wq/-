"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const CATEGORIES = [
  "連絡ノート",
  "有給・欠勤・遅刻・早退",
  "インシデントレポート",
  "院内ルール",
  "知識系",
  "つぶやき",
  "器具の修理",
];

interface Comment { id: string; content: string; createdAt: string; author: { id: string; name: string }; }
interface Post {
  id: string;
  title: string;
  content: string;
  imageData?: string;
  category: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; name: string };
  comments: Comment[];
  _count: { comments: number };
}

export default function BoardPage() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newPost, setNewPost] = useState({ title: "", content: "", category: "連絡ノート", imageData: "" });
  const [showForm, setShowForm] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchPosts(); }, [selectedCategory]);

  async function fetchPosts() {
    const url = selectedCategory ? `/api/posts?category=${encodeURIComponent(selectedCategory)}` : "/api/posts";
    const res = await fetch(url);
    if (res.ok) setPosts(await res.json());
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert("画像は3MB以下にしてください"); return; }
    const reader = new FileReader();
    reader.onload = () => setNewPost(p => ({ ...p, imageData: reader.result as string }));
    reader.readAsDataURL(file);
  }

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPost),
    });
    if (res.ok) {
      setNewPost({ title: "", content: "", category: "連絡ノート", imageData: "" });
      setShowForm(false);
      fetchPosts();
    }
  }

  async function addComment(postId: string) {
    const content = commentText[postId];
    if (!content?.trim()) return;
    const res = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setCommentText({ ...commentText, [postId]: "" });
      fetchPosts();
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="flex h-full">
      {/* Category sidebar */}
      <div className="w-52 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">掲示板</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              selectedCategory === null ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <span>📋</span> すべて
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                selectedCategory === cat ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <span>📝</span>
              <span className="truncate">{cat}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-gray-50">
        <div className="max-w-2xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold text-gray-900">
              {selectedCategory ?? "すべての掲示板"}
            </h1>
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              + 投稿する
            </button>
          </div>

          {showForm && (
            <form onSubmit={createPost} className="bg-white rounded-xl shadow-sm p-5 mb-6 border border-gray-200">
              <h2 className="font-semibold text-gray-800 mb-4">新規投稿</h2>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">掲示板</label>
                <select
                  value={newPost.category}
                  onChange={e => setNewPost({ ...newPost, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <input
                type="text"
                required
                value={newPost.title}
                onChange={e => setNewPost({ ...newPost, title: e.target.value })}
                placeholder="件名"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <textarea
                required
                value={newPost.content}
                onChange={e => setNewPost({ ...newPost, content: e.target.value })}
                placeholder="本文を入力..."
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {/* Image upload */}
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-indigo-600 border border-dashed border-gray-300 hover:border-indigo-400 rounded-lg px-4 py-2 transition-colors"
                >
                  🖼 画像を添付
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                {newPost.imageData && (
                  <div className="mt-2 relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newPost.imageData} alt="プレビュー" className="max-h-40 rounded-lg border border-gray-200" />
                    <button
                      type="button"
                      onClick={() => setNewPost(p => ({ ...p, imageData: "" }))}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                    >✕</button>
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
                <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">投稿</button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {posts.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-4">📋</p>
                <p>まだ投稿がありません</p>
              </div>
            )}
            {posts.map(post => (
              <div key={post.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    {post.pinned && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">📌 固定</span>}
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{post.category}</span>
                  </div>
                  <h2 className="font-semibold text-gray-900 mt-2">{post.title}</h2>
                  <p className="text-gray-600 text-sm whitespace-pre-wrap mt-1">{post.content}</p>
                  {post.imageData && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.imageData} alt="添付画像" className="mt-3 max-h-64 rounded-lg border border-gray-200 cursor-pointer" onClick={() => window.open(post.imageData)} />
                  )}
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-indigo-200 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700">
                        {post.author.name[0]}
                      </div>
                      <span className="text-xs text-gray-500">{post.author.name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{formatDate(post.createdAt)}</span>
                    <button
                      onClick={() => setExpandedPost(expandedPost === post.id ? null : post.id)}
                      className="ml-auto text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-1"
                    >
                      💬 {post._count.comments}件 {expandedPost === post.id ? "▲" : "▼"}
                    </button>
                  </div>
                </div>

                {expandedPost === post.id && (
                  <div className="border-t border-gray-100 px-5 pb-5">
                    <div className="mt-4 space-y-3">
                      {post.comments.map(c => (
                        <div key={c.id} className="flex gap-2">
                          <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {c.author.name[0]}
                          </div>
                          <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-gray-700">{c.author.name}</p>
                            <p className="text-sm text-gray-600 mt-0.5">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={commentText[post.id] ?? ""}
                        onChange={e => setCommentText({ ...commentText, [post.id]: e.target.value })}
                        placeholder="コメントを入力..."
                        className="flex-1 border border-gray-300 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        onKeyDown={e => { if (e.key === "Enter") addComment(post.id); }}
                      />
                      <button onClick={() => addComment(post.id)} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-full hover:bg-indigo-700">送信</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

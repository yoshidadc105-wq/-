"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const CATEGORIES = [
  "連絡ノート", "有給・欠勤・遅刻・早退", "インシデントレポート",
  "院内ルール", "知識系", "つぶやき", "器具の修理",
];
const STAMPS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏"];

interface Comment { id: string; content: string; createdAt: string; author: { id: string; name: string }; }
interface Reaction { id: string; emoji: string; user: { id: string; name: string }; }
interface Post {
  id: string; title: string; content: string; imageData?: string;
  category: string; pinned: boolean; createdAt: string;
  author: { id: string; name: string };
  comments: Comment[];
  reactions: Reaction[];
  _count: { comments: number };
}

// 色のリスト（ユーザーアバター用）
const COLORS = ["bg-red-400","bg-orange-400","bg-yellow-400","bg-green-400","bg-teal-400","bg-blue-400","bg-indigo-400","bg-purple-400","bg-pink-400"];
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[h];
}

export default function BoardPage() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [newPost, setNewPost] = useState({ title: "", content: "", category: "連絡ノート", imageData: "" });
  const [showForm, setShowForm] = useState(false);
  const [showCatMenu, setShowCatMenu] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [stampTarget, setStampTarget] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
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
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPost),
    });
    if (res.ok) {
      setNewPost({ title: "", content: "", category: "連絡ノート", imageData: "" });
      setShowForm(false); fetchPosts();
    }
  }

  async function addComment(postId: string) {
    const content = commentText[postId];
    if (!content?.trim()) return;
    const res = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) { setCommentText({ ...commentText, [postId]: "" }); fetchPosts(); }
  }

  async function toggleReaction(postId: string, emoji: string) {
    const res = await fetch(`/api/posts/${postId}/reactions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (res.ok) {
      const reactions = await res.json();
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, reactions } : p));
    }
    setStampTarget(null);
  }

  // emoji ごとに押した人の一覧を作る
  function groupReactions(reactions: Reaction[]) {
    const map: Record<string, { users: { id: string; name: string }[] }> = {};
    for (const r of reactions) {
      if (!map[r.emoji]) map[r.emoji] = { users: [] };
      map[r.emoji].users.push(r.user);
    }
    return map;
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="flex h-full" onClick={() => { setStampTarget(null); setShowCatMenu(false); }}>
      {/* Desktop sidebar */}
      <div className="hidden md:flex w-52 border-r border-gray-200 bg-white flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">掲示板</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button onClick={() => setSelectedCategory(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${selectedCategory === null ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-100"}`}>
            📋 すべて
          </button>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${selectedCategory === cat ? "bg-indigo-100 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-100"}`}>
              <span className="truncate">📝 {cat}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-gray-50">
        <div className="max-w-2xl mx-auto p-4">
          {/* Mobile category */}
          <div className="md:hidden mb-3">
            <button onClick={e => { e.stopPropagation(); setShowCatMenu(!showCatMenu); }}
              className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm font-medium text-gray-700">
              <span>📋 {selectedCategory ?? "すべて"}</span><span>{showCatMenu ? "▲" : "▼"}</span>
            </button>
            {showCatMenu && (
              <div className="bg-white border border-gray-200 rounded-lg mt-1 shadow-lg overflow-hidden z-10 relative" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setSelectedCategory(null); setShowCatMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50">すべて</button>
                {CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => { setSelectedCategory(cat); setShowCatMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 border-t border-gray-100">{cat}</button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-bold text-gray-900">{selectedCategory ?? "すべての掲示板"}</h1>
            <button onClick={() => setShowForm(!showForm)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">+ 投稿</button>
          </div>

          {showForm && (
            <form onSubmit={createPost} className="bg-white rounded-xl shadow-sm p-4 mb-4 border border-gray-200" onClick={e => e.stopPropagation()}>
              <select value={newPost.category} onChange={e => setNewPost({ ...newPost, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="text" required value={newPost.title} onChange={e => setNewPost({ ...newPost, title: e.target.value })}
                placeholder="件名" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <textarea required value={newPost.content} onChange={e => setNewPost({ ...newPost, content: e.target.value })}
                placeholder="本文..." rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="mb-3">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-indigo-600 border border-dashed border-gray-300 rounded-lg px-4 py-2">🖼 画像を添付</button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                {newPost.imageData && (
                  <div className="mt-2 relative inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newPost.imageData} alt="preview" className="max-h-32 rounded-lg border" />
                    <button type="button" onClick={() => setNewPost(p => ({ ...p, imageData: "" }))}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button>
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
                <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">投稿</button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {posts.length === 0 && (
              <div className="text-center py-12 text-gray-400"><p className="text-4xl mb-3">📋</p><p className="text-sm">まだ投稿がありません</p></div>
            )}
            {posts.map(post => {
              const grouped = groupReactions(post.reactions);
              const isExpanded = expandedPost === post.id;
              return (
                <div key={post.id} className="bg-white rounded-xl shadow-sm border border-gray-200" onClick={e => e.stopPropagation()}>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {post.pinned && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">📌 固定</span>}
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{post.category}</span>
                    </div>
                    <div className="flex items-start gap-3 mt-2">
                      <div className={`w-8 h-8 ${avatarColor(post.author.name)} rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                        {post.author.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{post.author.name}</span>
                          <span className="text-xs text-gray-400">{formatDate(post.createdAt)}</span>
                        </div>
                        <h2 className="font-semibold text-gray-900 text-sm mt-1">{post.title}</h2>
                        <p className="text-gray-600 text-sm whitespace-pre-wrap mt-1">{post.content}</p>
                        {post.imageData && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={post.imageData} alt="添付" className="mt-2 max-h-56 w-full object-contain rounded-lg border border-gray-200 cursor-pointer" onClick={() => setPreviewImage(post.imageData!)} />
                        )}
                      </div>
                    </div>

                    {/* リアクション表示（LINE WORKSスタイル：誰が押したか） */}
                    {Object.keys(grouped).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs text-gray-400 mb-2">リアクション</p>
                        <div className="flex flex-wrap gap-3">
                          {Object.entries(grouped).map(([emoji, { users }]) => (
                            <div key={emoji} className="flex flex-col items-center gap-1">
                              {/* アバター一覧 */}
                              <div className="flex flex-wrap gap-1 max-w-48">
                                {users.map(u => (
                                  <button key={u.id} onClick={() => toggleReaction(post.id, emoji)}
                                    title={`${u.name}が${emoji}を押しました`}
                                    className={`w-8 h-8 ${avatarColor(u.name)} rounded-full flex items-center justify-center text-xs font-bold text-white hover:opacity-80 transition-opacity ${u.id === session?.user?.id ? "ring-2 ring-indigo-400" : ""}`}>
                                    {u.name[0]}
                                  </button>
                                ))}
                              </div>
                              <span className="text-sm">{emoji} <span className="text-xs text-gray-500">{users.length}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* アクションバー */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                      {/* スタンプボタン */}
                      <div className="relative">
                        <button onClick={e => { e.stopPropagation(); setStampTarget(stampTarget === post.id ? null : post.id); }}
                          className="flex items-center gap-1 text-sm text-gray-500 hover:text-yellow-500 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                          😊 スタンプ
                        </button>
                        {stampTarget === post.id && (
                          <div className="absolute bottom-10 left-0 flex gap-1 bg-white rounded-2xl shadow-xl border border-gray-200 px-3 py-2 z-20"
                            onClick={e => e.stopPropagation()}>
                            {STAMPS.map(e => (
                              <button key={e} onClick={() => toggleReaction(post.id, e)}
                                className="text-xl hover:scale-125 transition-transform p-1">{e}</button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* コメントボタン（目立つデザイン） */}
                      <button onClick={() => setExpandedPost(isExpanded ? null : post.id)}
                        className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${isExpanded ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100 hover:text-indigo-600"}`}>
                        💬 コメント
                        {post._count.comments > 0 && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${isExpanded ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-600"}`}>
                            {post._count.comments}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* コメント欄 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                      <div className="space-y-3 mb-3">
                        {post.comments.length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">まだコメントはありません</p>
                        )}
                        {post.comments.map(c => (
                          <div key={c.id} className="flex gap-2">
                            <div className={`w-7 h-7 ${avatarColor(c.author.name)} rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                              {c.author.name[0]}
                            </div>
                            <div className="flex-1 bg-white rounded-xl px-3 py-2 shadow-sm">
                              <p className="text-xs font-semibold text-gray-700">{c.author.name}</p>
                              <p className="text-sm text-gray-600 mt-0.5">{c.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input value={commentText[post.id] ?? ""}
                          onChange={e => setCommentText({ ...commentText, [post.id]: e.target.value })}
                          placeholder="コメントを入力..."
                          className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          onKeyDown={e => { if (e.key === "Enter") addComment(post.id); }} />
                        <button onClick={() => addComment(post.id)}
                          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-full hover:bg-indigo-700 font-medium">送信</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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

"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface Comment { id: string; content: string; createdAt: string; author: { id: string; name: string }; }
interface Post {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; name: string };
  comments: Comment[];
  _count: { comments: number };
}

export default function BoardPage() {
  const { data: session } = useSession();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState({ title: "", content: "" });
  const [showForm, setShowForm] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<Record<string, string>>({});

  useEffect(() => { fetchPosts(); }, []);

  async function fetchPosts() {
    const res = await fetch("/api/posts");
    if (res.ok) setPosts(await res.json());
  }

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPost),
    });
    if (res.ok) {
      setNewPost({ title: "", content: "" });
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
    <div className="h-full overflow-y-auto scrollbar-thin bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">掲示板</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + 投稿する
          </button>
        </div>

        {showForm && (
          <form onSubmit={createPost} className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-4">新規投稿</h2>
            <input
              type="text"
              required
              value={newPost.title}
              onChange={e => setNewPost({ ...newPost, title: e.target.value })}
              placeholder="タイトル"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              required
              value={newPost.content}
              onChange={e => setNewPost({ ...newPost, content: e.target.value })}
              placeholder="内容を入力..."
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">投稿</button>
            </div>
          </form>
        )}

        <div className="space-y-4">
          {posts.map(post => (
            <div key={post.id} className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {post.pinned && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">📌 固定</span>}
                      <h2 className="font-semibold text-gray-900">{post.title}</h2>
                    </div>
                    <p className="text-gray-600 text-sm whitespace-pre-wrap">{post.content}</p>
                  </div>
                </div>
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
                    💬 {post._count.comments}件のコメント
                    <span>{expandedPost === post.id ? "▲" : "▼"}</span>
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
                    <button
                      onClick={() => addComment(post.id)}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-full hover:bg-indigo-700"
                    >
                      送信
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

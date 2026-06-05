"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";

const STAMP_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏"];

interface User { id: string; name: string; avatar?: string; email: string; }
interface Reaction { id: string; emoji: string; user: { id: string; name: string }; }
interface Message {
  id: string; content: string; imageData?: string; createdAt: string;
  sender: { id: string; name: string; avatar?: string; };
  reactions: Reaction[];
  deleted?: boolean;
}
interface ConvMember { user: User; lastReadAt?: string; }
interface Conversation {
  id: string; members: ConvMember[];
  messages: (Message & { sender: { name: string } })[];
  updatedAt: string;
}

export default function ChatPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [showUsers, setShowUsers] = useState(false);
  const [showList, setShowList] = useState(true);
  const [stampTarget, setStampTarget] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sendImageData, setSendImageData] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const convIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => { fetchConversations(); fetchUsers(); }, []);

  const fetchMessages = useCallback(async (convId: string, scrollBottom = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (res.ok && convIdRef.current === convId) {
        const data = await res.json();
        setMessages(data);
        if (scrollBottom) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (selectedConv) {
      convIdRef.current = selectedConv.id;
      fetchMessages(selectedConv.id, true);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => fetchMessages(selectedConv.id), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedConv?.id, fetchMessages]);

  async function fetchConversations() {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }
  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }

  async function startConversation(userId: string) {
    const res = await fetch("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: userId }),
    });
    if (res.ok) {
      const conv = await res.json();
      await fetchConversations();
      setSelectedConv(conv);
      setShowUsers(false);
      setShowList(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if ((!newMsg.trim() && !sendImageData) || !selectedConv || sending) return;
    setSending(true);
    const content = newMsg;
    const img = sendImageData;
    setNewMsg(""); setSendImageData(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConv.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, imageData: img }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        fetchConversations();
        // 送信直後に即時ポーリングして相手側の更新を確認
        setTimeout(() => fetchMessages(selectedConv.id), 500);
      }
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(messageId: string) {
    const res = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
    if (res.ok) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } else {
      const data = await res.json();
      alert(data.error || "取り消しできませんでした");
    }
    setMenuTarget(null);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const res = await fetch(`/api/messages/${messageId}/reactions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (res.ok) {
      const reactions = await res.json();
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    }
    setStampTarget(null);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("画像は5MB以下にしてください"); return; }
    const reader = new FileReader();
    reader.onload = () => setSendImageData(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function getOtherUser(conv: Conversation) {
    return conv.members.find(m => m.user.id !== session?.user?.id)?.user;
  }
  function getOtherMember(conv: Conversation) {
    return conv.members.find(m => m.user.id !== session?.user?.id);
  }
  function formatTime(d: string) {
    return new Date(d).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  function formatListTime(d: string) {
    const date = new Date(d); const now = new Date();
    if (date.toDateString() === now.toDateString()) return formatTime(d);
    return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  }
  function groupReactions(reactions: Reaction[]) {
    const map: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
    for (const r of reactions) {
      if (!map[r.emoji]) map[r.emoji] = { count: 0, users: [], hasMe: false };
      map[r.emoji].count++;
      map[r.emoji].users.push(r.user.name);
      if (r.user.id === session?.user?.id) map[r.emoji].hasMe = true;
    }
    return map;
  }
  function isRead(conv: Conversation, msgCreatedAt: string) {
    const other = getOtherMember(conv);
    if (!other?.lastReadAt) return false;
    return new Date(other.lastReadAt) >= new Date(msgCreatedAt);
  }

  // 送信から24時間以内か（LINEと同仕様）
  function canDelete(createdAt: string) {
    return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
  }

  return (
    <div className="flex h-full bg-gray-100" onClick={() => { setStampTarget(null); setMenuTarget(null); }}>
      {/* Conversation list */}
      <div className={`${showList ? "flex" : "hidden"} md:flex w-full md:w-80 bg-white flex-col flex-shrink-0 border-r border-gray-200`}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">トーク</h2>
          <button onClick={() => setShowUsers(!showUsers)}
            className="w-8 h-8 bg-green-500 text-white rounded-full text-lg flex items-center justify-center hover:bg-green-600">+</button>
        </div>

        {showUsers && (
          <div className="border-b border-gray-200 bg-gray-50 max-h-52 overflow-y-auto">
            <p className="text-xs text-gray-500 px-4 py-2 font-medium">メンバーを選択</p>
            {users.filter(u => u.id !== session?.user?.id).map(u => (
              <button key={u.id} onClick={() => startConversation(u.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white text-left">
                <div className="w-10 h-10 bg-green-200 rounded-full flex items-center justify-center text-sm font-bold text-green-700 flex-shrink-0">{u.name[0]}</div>
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
              </button>
            ))}
            {users.filter(u => u.id !== session?.user?.id).length === 0 && (
              <p className="text-xs text-gray-400 px-4 py-3">他のユーザーがいません</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <p className="text-sm text-gray-400 text-center mt-10 px-4">+ボタンでトークを始めましょう</p>}
          {conversations.map(conv => {
            const other = getOtherUser(conv);
            const lastMsg = conv.messages[0];
            return (
              <button key={conv.id} onClick={() => { setSelectedConv(conv); setShowList(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-gray-100 ${selectedConv?.id === conv.id ? "bg-green-50" : ""}`}>
                <div className="w-12 h-12 bg-green-200 rounded-full flex items-center justify-center text-base font-bold text-green-700 flex-shrink-0">{other?.name[0] ?? "?"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm text-gray-900 truncate">{other?.name}</p>
                    {lastMsg && <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{formatListTime(lastMsg.createdAt)}</span>}
                  </div>
                  {lastMsg && <p className="text-xs text-gray-500 truncate mt-0.5">{lastMsg.imageData ? "📷 画像" : lastMsg.content}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className={`${!showList ? "flex" : "hidden"} md:flex flex-1 flex-col min-w-0`}>
        {selectedConv ? (
          <>
            <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3 shadow-sm flex-shrink-0">
              <button onClick={() => setShowList(true)} className="md:hidden text-gray-500 text-xl mr-1">←</button>
              <div className="w-9 h-9 bg-green-200 rounded-full flex items-center justify-center text-sm font-bold text-green-700 flex-shrink-0">
                {getOtherUser(selectedConv)?.name[0]}
              </div>
              <span className="font-semibold text-gray-900">{getOtherUser(selectedConv)?.name}</span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1"
              onClick={() => { setStampTarget(null); setMenuTarget(null); }}
              style={{ backgroundImage: "radial-gradient(circle, #e8f5e9 1px, transparent 1px)", backgroundSize: "20px 20px", backgroundColor: "#f1f8e9" }}>
              {messages.map((msg, i) => {
                const isMe = msg.sender.id === session?.user?.id;
                const grouped = groupReactions(msg.reactions);
                const prevMsg = messages[i - 1];
                const showName = !isMe && (!prevMsg || prevMsg.sender.id !== msg.sender.id);
                const showMenu = menuTarget === msg.id;
                const showStamp = stampTarget === msg.id;

                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    {showName && <span className="text-xs text-gray-500 ml-10 mb-0.5">{msg.sender.name}</span>}

                    <div className={`flex items-end gap-1.5 max-w-[85%] ${isMe ? "flex-row-reverse" : ""}`}>
                      {!isMe && (
                        <div className="w-8 h-8 bg-green-200 rounded-full flex items-center justify-center text-xs font-bold text-green-700 flex-shrink-0 self-end">
                          {msg.sender.name[0]}
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <div className={`flex items-end gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
                          {/* 吹き出し */}
                          <div
                            className={`relative rounded-2xl shadow-sm
                              ${msg.content || msg.imageData ? "px-3 py-2" : ""}
                              ${isMe ? "bg-green-400 text-white rounded-br-sm" : "bg-white text-gray-900 rounded-bl-sm"}`}
                            onDoubleClick={e => { e.stopPropagation(); setStampTarget(msg.id); setMenuTarget(null); }}
                            onClick={e => { e.stopPropagation(); if (isMe) { setMenuTarget(showMenu ? null : msg.id); setStampTarget(null); } }}
                          >
                            {msg.content && <p className="text-sm whitespace-pre-wrap break-words max-w-[200px] md:max-w-xs">{msg.content}</p>}
                            {msg.imageData && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={msg.imageData} alt="画像" className="max-w-[180px] md:max-w-[220px] max-h-48 rounded-xl cursor-pointer mt-1" onClick={e => { e.stopPropagation(); setPreviewImage(msg.imageData!); }} />
                            )}

                            {/* 自分のメッセージ：取り消しメニュー */}
                            {isMe && showMenu && (
                              <div className="absolute bottom-full right-0 mb-1 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-20 min-w-32"
                                onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => { setStampTarget(msg.id); setMenuTarget(null); }}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                                  😊 スタンプ
                                </button>
                                {canDelete(msg.createdAt) && (
                                  <button onClick={() => { if (confirm("このメッセージを取り消しますか？")) deleteMessage(msg.id); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 border-t border-gray-100">
                                    🗑 送信取り消し
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 時刻・既読 */}
                          <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} gap-0.5 flex-shrink-0`}>
                            {isMe && isRead(selectedConv, msg.createdAt) && (
                              <span className="text-xs text-green-600 font-medium">既読</span>
                            )}
                            <span className="text-xs text-gray-400">{formatTime(msg.createdAt)}</span>
                          </div>
                        </div>

                        {/* リアクション */}
                        {Object.keys(grouped).length > 0 && (
                          <div className={`flex flex-wrap gap-1 ${isMe ? "justify-end" : "justify-start"}`}>
                            {Object.entries(grouped).map(([emoji, { count, users, hasMe }]) => (
                              <button key={emoji} onClick={e => { e.stopPropagation(); toggleReaction(msg.id, emoji); }}
                                title={users.join(", ")}
                                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition-colors
                                  ${hasMe ? "bg-green-100 border-green-400 text-green-700" : "bg-white border-gray-300 text-gray-600"}`}>
                                {emoji} {count}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* スタンプピッカー */}
                        {showStamp && (
                          <div className={`flex gap-1 bg-white rounded-full shadow-xl border border-gray-200 px-2 py-1.5 z-20 ${isMe ? "self-end" : "self-start"}`}
                            onClick={e => e.stopPropagation()}>
                            {STAMP_EMOJIS.map(e => (
                              <button key={e} onClick={() => toggleReaction(msg.id, e)}
                                className="text-xl hover:scale-125 transition-transform p-0.5">{e}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* 画像プレビュー（送信前） */}
            {sendImageData && (
              <div className="px-4 py-2 bg-white border-t border-gray-100 flex items-center gap-3 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sendImageData} alt="preview" className="h-14 rounded-lg border border-gray-200" />
                <span className="text-xs text-gray-500">画像を送信</span>
                <button onClick={() => setSendImageData(null)} className="ml-auto text-red-400 text-sm">✕ 取り消す</button>
              </div>
            )}

            {/* 入力バー */}
            <form onSubmit={sendMessage} className="px-2 py-2 bg-white border-t border-gray-200 flex items-center gap-1.5 flex-shrink-0 w-full">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="text-gray-400 hover:text-green-600 text-xl flex-shrink-0 p-1 w-8">📷</button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                placeholder="メッセージを入力..."
                className="flex-1 bg-gray-100 rounded-full px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 min-w-0 w-0" />
              <button type="submit" disabled={(!newMsg.trim() && !sendImageData) || sending}
                className="w-9 h-9 min-w-[2.25rem] bg-green-500 text-white rounded-full flex items-center justify-center disabled:opacity-40 hover:bg-green-600 flex-shrink-0">
                {sending ? "…" : "➤"}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-400">
              <p className="text-5xl mb-4">💬</p>
              <p className="font-medium">トークを選択してください</p>
              <button onClick={() => setShowList(true)} className="md:hidden mt-3 text-sm text-green-600">← 一覧に戻る</button>
            </div>
          </div>
        )}
      </div>

      {/* 画像フルスクリーン */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewImage} alt="フルサイズ" className="max-w-full max-h-full rounded-lg" />
          <button className="absolute top-4 right-4 text-white text-3xl">✕</button>
        </div>
      )}
    </div>
  );
}

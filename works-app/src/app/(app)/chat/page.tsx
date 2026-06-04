"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const STAMP_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "👏"];

interface User { id: string; name: string; avatar?: string; email: string; }
interface Reaction { id: string; emoji: string; user: { id: string; name: string }; }
interface Message {
  id: string; content: string; imageData?: string; createdAt: string;
  sender: { id: string; name: string; avatar?: string; };
  reactions: Reaction[];
}
interface Conversation {
  id: string;
  members: { user: User; lastReadAt?: string }[];
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sendImageData, setSendImageData] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchConversations(); fetchUsers(); }, []);
  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => fetchMessages(selectedConv.id), 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedConv?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function fetchConversations() {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }
  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
  }
  async function fetchMessages(convId: string) {
    const res = await fetch(`/api/conversations/${convId}/messages`);
    if (res.ok) setMessages(await res.json());
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
    if ((!newMsg.trim() && !sendImageData) || !selectedConv) return;
    const res = await fetch(`/api/conversations/${selectedConv.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newMsg, imageData: sendImageData }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages(prev => [...prev, msg]);
      setNewMsg(""); setSendImageData(null);
      fetchConversations();
    }
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
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return formatTime(d);
    return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  }

  // Group reactions by emoji
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

  // Check if other user has read up to this message
  function isRead(conv: Conversation, msgCreatedAt: string) {
    const other = getOtherMember(conv);
    if (!other?.lastReadAt) return false;
    return new Date(other.lastReadAt) >= new Date(msgCreatedAt);
  }

  return (
    <div className="flex h-full bg-gray-100">
      {/* Conversation list */}
      <div className={`${showList ? "flex" : "hidden"} md:flex w-full md:w-80 bg-white flex-col flex-shrink-0 border-r border-gray-200`}>
        <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-800 text-base">トーク</h2>
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
          {conversations.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-10 px-4">+ボタンでトークを始めましょう</p>
          )}
          {conversations.map(conv => {
            const other = getOtherUser(conv);
            const lastMsg = conv.messages[0];
            return (
              <button key={conv.id} onClick={() => { setSelectedConv(conv); setShowList(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-gray-100 transition-colors ${selectedConv?.id === conv.id ? "bg-green-50" : ""}`}>
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
      <div className={`${!showList ? "flex" : "hidden"} md:flex flex-1 flex-col`}>
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3 shadow-sm">
              <button onClick={() => setShowList(true)} className="md:hidden text-gray-500 text-xl mr-1">←</button>
              <div className="w-9 h-9 bg-green-200 rounded-full flex items-center justify-center text-sm font-bold text-green-700 flex-shrink-0">
                {getOtherUser(selectedConv)?.name[0]}
              </div>
              <span className="font-semibold text-gray-900">{getOtherUser(selectedConv)?.name}</span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1" onClick={() => setStampTarget(null)}
              style={{ backgroundImage: "radial-gradient(circle, #e8f5e9 1px, transparent 1px)", backgroundSize: "20px 20px", backgroundColor: "#f1f8e9" }}>
              {messages.map((msg, i) => {
                const isMe = msg.sender.id === session?.user?.id;
                const grouped = groupReactions(msg.reactions);
                const prevMsg = messages[i - 1];
                const showSenderName = !isMe && (!prevMsg || prevMsg.sender.id !== msg.sender.id);

                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} mb-1`}>
                    {showSenderName && (
                      <span className="text-xs text-gray-500 ml-10 mb-1">{msg.sender.name}</span>
                    )}
                    <div className={`flex items-end gap-2 max-w-[80%] ${isMe ? "flex-row-reverse" : ""}`}>
                      {!isMe && (
                        <div className="w-8 h-8 bg-green-200 rounded-full flex items-center justify-center text-xs font-bold text-green-700 flex-shrink-0 self-end">
                          {msg.sender.name[0]}
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <div className={`flex items-end gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
                          {/* Bubble */}
                          <div
                            className={`relative rounded-2xl px-3 py-2 shadow-sm cursor-pointer select-none
                              ${isMe ? "bg-green-400 text-white rounded-br-sm" : "bg-white text-gray-900 rounded-bl-sm"}
                              ${msg.content || msg.imageData ? "" : "hidden"}`}
                            onDoubleClick={() => setStampTarget(stampTarget === msg.id ? null : msg.id)}
                          >
                            {msg.content && <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>}
                            {msg.imageData && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={msg.imageData} alt="画像" className="max-w-48 max-h-48 rounded-xl cursor-pointer mt-1" onClick={() => setPreviewImage(msg.imageData!)} />
                            )}
                          </div>
                          {/* Time + read */}
                          <div className={`flex flex-col items-${isMe ? "end" : "start"} gap-0.5`}>
                            {isMe && isRead(selectedConv, msg.createdAt) && (
                              <span className="text-xs text-green-600 font-medium">既読</span>
                            )}
                            <span className="text-xs text-gray-400 whitespace-nowrap">{formatTime(msg.createdAt)}</span>
                          </div>
                        </div>

                        {/* Reactions */}
                        {Object.keys(grouped).length > 0 && (
                          <div className={`flex flex-wrap gap-1 ${isMe ? "justify-end" : "justify-start"} ml-1`}>
                            {Object.entries(grouped).map(([emoji, { count, users, hasMe }]) => (
                              <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                                title={users.join(", ")}
                                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition-colors
                                  ${hasMe ? "bg-green-100 border-green-400 text-green-700" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                                <span>{emoji}</span><span>{count}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Stamp picker */}
                        {stampTarget === msg.id && (
                          <div className={`flex gap-1 bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 ${isMe ? "self-end" : "self-start"}`}
                            onClick={e => e.stopPropagation()}>
                            {STAMP_EMOJIS.map(e => (
                              <button key={e} onClick={() => toggleReaction(msg.id, e)}
                                className="text-lg hover:scale-125 transition-transform p-0.5">{e}</button>
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

            {/* Image preview before send */}
            {sendImageData && (
              <div className="px-4 py-2 bg-white border-t border-gray-100 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sendImageData} alt="preview" className="h-16 rounded-lg border border-gray-200" />
                <button onClick={() => setSendImageData(null)} className="text-red-400 hover:text-red-600 text-sm">✕ 取り消す</button>
              </div>
            )}

            {/* Input bar */}
            <form onSubmit={sendMessage} className="px-3 py-2 bg-white border-t border-gray-200 flex items-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="text-gray-500 hover:text-green-600 text-xl flex-shrink-0">📷</button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                placeholder="メッセージを入力..."
                className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
              <button type="submit" disabled={!newMsg.trim() && !sendImageData}
                className="w-9 h-9 bg-green-500 text-white rounded-full flex items-center justify-center disabled:opacity-40 hover:bg-green-600 flex-shrink-0 text-sm">
                ➤
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

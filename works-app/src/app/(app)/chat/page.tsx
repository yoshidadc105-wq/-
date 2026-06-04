"use client";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

interface User { id: string; name: string; avatar?: string; email: string; }
interface Message { id: string; content: string; createdAt: string; sender: { id: string; name: string; avatar?: string; }; }
interface Conversation {
  id: string;
  members: { user: User }[];
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
  const [showList, setShowList] = useState(true); // mobile: show list or chat
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchConversations(); fetchUsers(); }, []);
  useEffect(() => { if (selectedConv) fetchMessages(selectedConv.id); }, [selectedConv]);
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    if (!newMsg.trim() || !selectedConv) return;
    const res = await fetch(`/api/conversations/${selectedConv.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newMsg }),
    });
    if (res.ok) {
      const msg = await res.json();
      setMessages(prev => [...prev, msg]);
      setNewMsg("");
      fetchConversations();
    }
  }

  function getOtherUser(conv: Conversation) {
    return conv.members.find(m => m.user.id !== session?.user?.id)?.user;
  }
  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function openConv(conv: Conversation) {
    setSelectedConv(conv);
    setShowList(false);
  }

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className={`
        ${showList ? "flex" : "hidden"} md:flex
        w-full md:w-72 border-r border-gray-200 bg-white flex-col flex-shrink-0
      `}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">ダイレクトメッセージ</h2>
          <button
            onClick={() => setShowUsers(!showUsers)}
            className="w-8 h-8 bg-indigo-600 text-white rounded-full text-lg flex items-center justify-center hover:bg-indigo-700"
          >+</button>
        </div>

        {showUsers && (
          <div className="border-b border-gray-200 max-h-48 overflow-y-auto">
            {users.filter(u => u.id !== session?.user?.id).map(u => (
              <button key={u.id} onClick={() => startConversation(u.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left text-sm">
                <div className="w-9 h-9 bg-indigo-200 rounded-full flex items-center justify-center text-sm font-bold text-indigo-700 flex-shrink-0">
                  {u.name[0]}
                </div>
                <span>{u.name}</span>
              </button>
            ))}
            {users.filter(u => u.id !== session?.user?.id).length === 0 && (
              <p className="text-xs text-gray-400 px-4 py-3">他のユーザーがいません</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {conversations.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-8 px-4">+ボタンで会話を始めましょう</p>
          )}
          {conversations.map(conv => {
            const other = getOtherUser(conv);
            const lastMsg = conv.messages[0];
            return (
              <button key={conv.id} onClick={() => openConv(conv)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-gray-100 ${selectedConv?.id === conv.id ? "bg-indigo-50" : ""}`}>
                <div className="w-10 h-10 bg-indigo-200 rounded-full flex items-center justify-center text-sm font-bold text-indigo-700 flex-shrink-0">
                  {other?.name[0] ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900 truncate">{other?.name}</p>
                  {lastMsg && (
                    <p className="text-xs text-gray-500 truncate">{lastMsg.sender.name}: {lastMsg.content}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className={`
        ${!showList ? "flex" : "hidden"} md:flex
        flex-1 flex-col bg-white
      `}>
        {selectedConv ? (
          <>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
              {/* Back button on mobile */}
              <button onClick={() => setShowList(true)} className="md:hidden text-gray-500 text-xl mr-1">←</button>
              <div className="w-9 h-9 bg-indigo-200 rounded-full flex items-center justify-center text-sm font-bold text-indigo-700 flex-shrink-0">
                {getOtherUser(selectedConv)?.name[0]}
              </div>
              <span className="font-semibold">{getOtherUser(selectedConv)?.name}</span>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
              {messages.map(msg => {
                const isMe = msg.sender.id === session?.user?.id;
                return (
                  <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                    {!isMe && (
                      <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {msg.sender.name[0]}
                      </div>
                    )}
                    <div className={`max-w-[75%] flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                      {!isMe && <span className="text-xs text-gray-500">{msg.sender.name}</span>}
                      <div className={`px-4 py-2 rounded-2xl text-sm ${isMe ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                        {msg.content}
                      </div>
                      <span className="text-xs text-gray-400">{formatTime(msg.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={sendMessage} className="p-3 border-t border-gray-200 flex gap-2">
              <input
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                placeholder="メッセージを入力..."
                className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button type="submit" disabled={!newMsg.trim()}
                className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center disabled:opacity-50 hover:bg-indigo-700 flex-shrink-0">
                ➤
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-400">
              <p className="text-4xl mb-4">💬</p>
              <p>会話を選択してください</p>
              <button onClick={() => setShowList(true)} className="md:hidden mt-3 text-sm text-indigo-600">← 一覧に戻る</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

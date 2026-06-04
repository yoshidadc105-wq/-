"use client";
import { useEffect, useState } from "react";

export default function NotificationSetup() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") {
      registerSub();
    } else if (Notification.permission === "default") {
      setShowBanner(true);
    }
  }, []);

  async function registerSub() {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const res = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await res.json();
      const existing = await reg.pushManager.getSubscription();
      if (existing) return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (e) {
      console.error("Push setup failed", e);
    }
  }

  async function handleAllow() {
    const perm = await Notification.requestPermission();
    setShowBanner(false);
    if (perm === "granted") registerSub();
  }

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl px-5 py-4 flex items-center gap-4 max-w-sm w-[90vw]">
      <span className="text-2xl">🔔</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-900">通知を有効にする</p>
        <p className="text-xs text-gray-500">新着メッセージや投稿をお知らせします</p>
      </div>
      <div className="flex flex-col gap-1">
        <button onClick={handleAllow} className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 font-medium">許可</button>
        <button onClick={() => setShowBanner(false)} className="px-3 py-1.5 text-gray-400 text-xs rounded-lg hover:bg-gray-100">後で</button>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

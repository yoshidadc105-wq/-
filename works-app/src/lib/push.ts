import webpush from "web-push";
import { prisma } from "./prisma";

webpush.setVapidDetails(
  "mailto:admin@works-app.com",
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushToUsers(userIds: string[], payload: { title: string; body: string; url?: string }) {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });

  await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      ).catch(async (err) => {
        // 無効な購読を削除
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      })
    )
  );
}

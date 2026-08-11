const webpush = require("web-push");
const { query } = require("./db");

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set to send push notifications.");
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// Sends a push to every subscription row given, removing any that are no
// longer valid (the browser unsubscribed or the device is gone).
async function sendToSubscriptions(subscriptions, payload) {
  ensureConfigured();
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
        delivered++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
        }
        // Other errors (network blips etc.) are swallowed so one bad
        // subscription doesn't block delivery to everyone else.
      }
    })
  );
  return delivered;
}

module.exports = { sendToSubscriptions };

const errEl = document.getElementById("error");
const resultEl = document.getElementById("lookupResult");

function showError(msg) {
  errEl.textContent = msg;
  errEl.style.display = "block";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

document.getElementById("findBtn").addEventListener("click", async () => {
  errEl.style.display = "none";
  resultEl.innerHTML = "";
  const code = document.getElementById("code").value.trim().toUpperCase();
  if (!code) return showError("Enter a join code.");

  try {
    const res = await fetch(`/api/public/join/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!res.ok) return showError(data.error || "That code doesn't work.");

    resultEl.innerHTML = `
      <div class="card" style="background:#f8fafc;">
        <p class="muted" style="margin-bottom:2px;">${data.type === "school" ? "School-wide announcements" : data.type === "learner" ? "Updates for your child" : "Class updates"}</p>
        <p style="font-weight:600; margin:0 0 12px;">${data.label}</p>
        <button class="btn" style="width:100%;" id="enableBtn">Enable notifications for this device</button>
        <div id="subMsg"></div>
      </div>
    `;
    document.getElementById("enableBtn").addEventListener("click", () => enable(code));
  } catch (e) {
    showError("Couldn't reach the server. Try again.");
  }
});

async function enable(code) {
  const msgEl = document.getElementById("subMsg");
  msgEl.innerHTML = `<p class="muted">Setting up…</p>`;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    msgEl.innerHTML = `<p class="error">This browser doesn't support push notifications. Try a recent Chrome, Edge, or Firefox.</p>`;
    return;
  }
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
    msgEl.innerHTML = `<p class="error">Notifications need a secure (https) connection.</p>`;
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      msgEl.innerHTML = `<p class="error">Notifications were blocked. Enable them in your browser's site settings and try again.</p>`;
      return;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const keyRes = await fetch("/api/public/vapid-public-key");
    const { key } = await keyRes.json();
    if (!key) {
      msgEl.innerHTML = `<p class="error">This server hasn't been configured for push yet. Ask the site owner to set VAPID keys.</p>`;
      return;
    }

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    const res = await fetch("/api/public/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, subscription: subscription.toJSON() }),
    });
    const data = await res.json();
    if (!res.ok) {
      msgEl.innerHTML = `<p class="error">${data.error || "Couldn't finish setting up notifications."}</p>`;
      return;
    }
    msgEl.innerHTML = `<p class="success">You're all set. Notifications will appear on this device.</p>`;
  } catch (e) {
    msgEl.innerHTML = `<p class="error">Something went wrong setting up notifications: ${e.message}</p>`;
  }
}

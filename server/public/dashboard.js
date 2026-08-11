const token = localStorage.getItem("rc_token");
const user = JSON.parse(localStorage.getItem("rc_user") || "null");
if (!token || !user) window.location.href = "/login.html";

const app = document.getElementById("app");

function logout() {
  localStorage.removeItem("rc_token");
  localStorage.removeItem("rc_user");
  window.location.href = "/login.html";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("Session expired"); }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function el(html) {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function roleLabel(role) {
  return role === "super" ? "Super admin" : role === "schooladmin" ? "School admin" : "Teacher";
}

document.getElementById("whoName").textContent = user.name;
document.getElementById("whoEmail").textContent = user.email;
const roleBadge = document.getElementById("roleBadge");
roleBadge.textContent = roleLabel(user.role);
roleBadge.className = "badge " + (user.role === "super" ? "amber" : user.role === "schooladmin" ? "slate" : "green");

if (user.mustChangePassword) {
  renderPasswordChange();
} else if (user.role === "super") {
  renderSuperAdmin();
} else if (user.role === "schooladmin") {
  renderSchoolAdmin();
} else {
  renderTeacher();
}

// ---------- Forced password change ----------
function renderPasswordChange() {
  app.innerHTML = "";
  app.style.maxWidth = "420px";
  app.appendChild(
    el(`
    <div class="card">
      <h2 style="margin-bottom:4px;">Set a new password</h2>
      <p class="muted" style="margin:0 0 16px;">You're using a temporary password. Choose a permanent one to continue.</p>
      <div class="field"><label>New password</label><input id="newPw" type="password" /></div>
      <div id="pwErr" class="error" style="display:none;"></div>
      <button class="btn" style="width:100%;" id="pwBtn">Save password</button>
    </div>
  `)
  );
  document.getElementById("pwBtn").addEventListener("click", async () => {
    const errEl = document.getElementById("pwErr");
    errEl.style.display = "none";
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ newPassword: document.getElementById("newPw").value }) });
      user.mustChangePassword = false;
      localStorage.setItem("rc_user", JSON.stringify(user));
      if (user.role === "super") renderSuperAdmin();
      else if (user.role === "schooladmin") renderSchoolAdmin();
      else renderTeacher();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  });
}

// ---------- Super admin ----------
async function renderSuperAdmin() {
  app.style.maxWidth = "880px";
  app.innerHTML = `
    <div class="row">
      <div><h2>Schools</h2><p class="muted" style="margin:4px 0 0;">Create schools and manage which ones can use Roll Call.</p></div>
      <button class="btn" id="newSchoolBtn">New school</button>
    </div>
    <div id="schoolForm"></div>
    <div id="schoolList"></div>
  `;
  document.getElementById("newSchoolBtn").addEventListener("click", () => {
    const holder = document.getElementById("schoolForm");
    holder.innerHTML = holder.innerHTML ? "" : `
      <div class="card">
        <div class="grid cols-3">
          <div class="field"><label>School name</label><input id="sName" placeholder="Riverbend High" /></div>
          <div class="field"><label>Admin name</label><input id="sAdminName" placeholder="Jordan Lee" /></div>
          <div class="field"><label>Admin email</label><input id="sAdminEmail" placeholder="jordan@riverbend.edu" /></div>
        </div>
        <div id="sErr" class="error" style="display:none;"></div>
        <div id="sSuccess"></div>
        <button class="btn" id="sCreateBtn">Create school</button>
      </div>
    `;
    if (holder.innerHTML) {
      document.getElementById("sCreateBtn").addEventListener("click", async () => {
        const errEl = document.getElementById("sErr");
        errEl.style.display = "none";
        try {
          const result = await api("/api/superadmin/schools", {
            method: "POST",
            body: JSON.stringify({
              name: document.getElementById("sName").value,
              adminName: document.getElementById("sAdminName").value,
              adminEmail: document.getElementById("sAdminEmail").value,
            }),
          });
          document.getElementById("sSuccess").innerHTML = `<p class="success">School created. Share these one-time login details with ${escapeHtml(result.admin.name)}: <br><strong>${escapeHtml(result.admin.email)}</strong> / <code class="code">${escapeHtml(result.admin.tempPassword)}</code></p>`;
          loadSchools();
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        }
      });
    }
  });
  loadSchools();
}

async function loadSchools() {
  const listEl = document.getElementById("schoolList");
  listEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const schools = await api("/api/superadmin/schools");
    if (schools.length === 0) {
      listEl.innerHTML = `<div class="empty"><h3>No schools yet</h3><p>Create your first school to give it a login for its admin.</p></div>`;
      return;
    }
    listEl.innerHTML = `<div class="grid cols-2">` + schools.map((s) => `
      <div class="card" data-id="${s.id}">
        <div class="row">
          <div>
            <h3 style="font-size:17px;">${escapeHtml(s.name)}</h3>
            <p class="muted">${s.admin ? escapeHtml(s.admin.email) : ""}</p>
          </div>
          <span class="badge ${s.status === "active" ? "green" : "rose"}">${s.status === "active" ? "Active" : "Disabled"}</span>
        </div>
        <p class="muted" style="margin:10px 0;">${s.staff_count} staff · ${s.class_count} classes · ${s.learner_count} learners</p>
        <p class="muted">School join code: <code class="code">${escapeHtml(s.join_code)}</code></p>
        <button class="btn ${s.status === "active" ? "danger" : "ghost"} small toggle-btn" style="margin-top:8px;">
          ${s.status === "active" ? "Disable account" : "Enable account"}
        </button>
      </div>
    `).join("") + `</div>`;

    listEl.querySelectorAll(".toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const card = e.target.closest(".card");
        const id = card.dataset.id;
        const isActive = card.querySelector(".badge").textContent.trim() === "Active";
        await api(`/api/superadmin/schools/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: isActive ? "disabled" : "active" }),
        });
        loadSchools();
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ---------- School admin ----------
async function renderSchoolAdmin() {
  app.style.maxWidth = "880px";
  app.innerHTML = `
    <div class="row">
      <div><h2>Staff</h2><p class="muted" style="margin:4px 0 0;">Add teachers so they can build classes and message learners.</p></div>
      <button class="btn" id="newTeacherBtn">Add teacher</button>
    </div>
    <div id="teacherForm"></div>
    <div id="staffList"></div>
  `;
  document.getElementById("newTeacherBtn").addEventListener("click", () => {
    const holder = document.getElementById("teacherForm");
    holder.innerHTML = holder.innerHTML ? "" : `
      <div class="card">
        <div class="grid cols-2">
          <div class="field"><label>Teacher name</label><input id="tName" placeholder="Priya Nair" /></div>
          <div class="field"><label>Teacher email</label><input id="tEmail" placeholder="priya@riverbend.edu" /></div>
        </div>
        <div id="tErr" class="error" style="display:none;"></div>
        <div id="tSuccess"></div>
        <button class="btn" id="tCreateBtn">Add teacher</button>
      </div>
    `;
    if (holder.innerHTML) {
      document.getElementById("tCreateBtn").addEventListener("click", async () => {
        const errEl = document.getElementById("tErr");
        errEl.style.display = "none";
        try {
          const result = await api("/api/schooladmin/staff", {
            method: "POST",
            body: JSON.stringify({ name: document.getElementById("tName").value, email: document.getElementById("tEmail").value }),
          });
          document.getElementById("tSuccess").innerHTML = `<p class="success">Teacher added. Share these one-time login details: <br><strong>${escapeHtml(result.email)}</strong> / <code class="code">${escapeHtml(result.tempPassword)}</code></p>`;
          loadStaff();
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        }
      });
    }
  });
  loadStaff();
}

async function loadStaff() {
  const listEl = document.getElementById("staffList");
  listEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const staff = await api("/api/schooladmin/staff");
    if (staff.length === 0) {
      listEl.innerHTML = `<div class="empty"><h3>No teachers yet</h3><p>Add a teacher to give them a login for this school.</p></div>`;
      return;
    }
    listEl.innerHTML = `<div class="card"><ul class="list">` + staff.map((t) => `
      <li class="row">
        <div><div>${escapeHtml(t.name)}</div><div class="muted">${escapeHtml(t.email)}</div></div>
        <span class="badge green">${t.class_count} class${t.class_count === "1" ? "" : "es"}</span>
      </li>
    `).join("") + `</ul></div>`;
  } catch (e) {
    listEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Teacher ----------
let myClasses = [];

async function renderTeacher() {
  app.style.maxWidth = "880px";
  app.innerHTML = `
    <div class="tabs">
      <button class="tab-btn active" data-tab="classes">My classes</button>
      <button class="tab-btn" data-tab="attendance">Attendance</button>
      <button class="tab-btn" data-tab="notify">Send notification</button>
      <button class="tab-btn" data-tab="history">Notification history</button>
    </div>
    <div id="tabContent"></div>
  `;
  app.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      app.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showTab(btn.dataset.tab);
    });
  });
  await loadMyClasses();
  showTab("classes");
}

async function loadMyClasses() {
  myClasses = await api("/api/teacher/classes");
}

function showTab(tab) {
  if (tab === "classes") renderClassesTab();
  if (tab === "attendance") renderAttendanceTab();
  if (tab === "notify") renderNotifyTab();
  if (tab === "history") renderHistoryTab();
}

function renderClassesTab() {
  const holder = document.getElementById("tabContent");
  holder.innerHTML = `
    <div class="row">
      <p class="muted">Each class is one subject you teach. Share its join code so learners or parents can turn on notifications.</p>
      <button class="btn" id="newClassBtn">New class</button>
    </div>
    <div id="classForm"></div>
    <div id="classList"></div>
  `;
  document.getElementById("newClassBtn").addEventListener("click", () => {
    const f = document.getElementById("classForm");
    f.innerHTML = f.innerHTML ? "" : `
      <div class="card">
        <div class="grid cols-2">
          <div class="field"><label>Class name</label><input id="cName" placeholder="Grade 9B" /></div>
          <div class="field"><label>Subject</label><input id="cSubject" placeholder="Biology" /></div>
        </div>
        <div id="cErr" class="error" style="display:none;"></div>
        <button class="btn" id="cCreateBtn">Create class</button>
      </div>
    `;
    if (f.innerHTML) {
      document.getElementById("cCreateBtn").addEventListener("click", async () => {
        const errEl = document.getElementById("cErr");
        errEl.style.display = "none";
        try {
          await api("/api/teacher/classes", { method: "POST", body: JSON.stringify({ name: document.getElementById("cName").value, subject: document.getElementById("cSubject").value }) });
          await loadMyClasses();
          renderClassesTab();
        } catch (e) {
          errEl.textContent = e.message;
          errEl.style.display = "block";
        }
      });
    }
  });
  renderClassList();
}

function renderClassList() {
  const listEl = document.getElementById("classList");
  if (myClasses.length === 0) {
    listEl.innerHTML = `<div class="empty"><h3>No classes yet</h3><p>Create a class to start adding learners and sending notifications.</p></div>`;
    return;
  }
  listEl.innerHTML = myClasses.map((c) => `
    <div class="card" data-class="${c.id}">
      <div class="row" style="cursor:pointer;" class="class-toggle">
        <div>
          <h3 style="font-size:16px;">${escapeHtml(c.name)}</h3>
          <p class="muted">${escapeHtml(c.subject)} · join code <code class="code">${escapeHtml(c.join_code)}</code></p>
        </div>
        <span class="badge slate">${c.learner_count} learner${String(c.learner_count) === "1" ? "" : "s"}</span>
      </div>
      <div class="learner-panel" style="display:none; margin-top:14px; border-top:1px solid var(--line); padding-top:14px;"></div>
    </div>
  `).join("");

  listEl.querySelectorAll(".card").forEach((card) => {
    const row = card.querySelector(".row");
    const panel = card.querySelector(".learner-panel");
    row.addEventListener("click", async () => {
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "block";
      if (!open) await loadLearners(card.dataset.class, panel);
    });
  });
}

async function loadLearners(classId, panel) {
  panel.innerHTML = `<p class="muted">Loading…</p>`;
  const learners = await api(`/api/teacher/classes/${classId}/learners`);
  panel.innerHTML = `
    <div class="row" style="gap:8px;">
      <input placeholder="Learner name" id="learnerInput-${classId}" style="flex:1;" />
      <button class="btn small" id="addLearnerBtn-${classId}">Add</button>
    </div>
    <ul class="list" style="margin-top:10px;">
      ${learners.length === 0 ? '<p class="muted">No learners added yet.</p>' : learners.map((l) => `
        <li class="row">
          <span>${escapeHtml(l.name)} <span class="muted">· parent code <code class="code">${escapeHtml(l.join_code)}</code></span></span>
          <button class="btn danger small" data-learner="${l.id}">Remove</button>
        </li>
      `).join("")}
    </ul>
    <p class="muted" style="margin-top:8px;">Give each learner's parent code to their parent/guardian at <code class="code">/join.html</code> — it's how they'll get attendance alerts for their own child.</p>
  `;
  document.getElementById(`addLearnerBtn-${classId}`).addEventListener("click", async () => {
    const input = document.getElementById(`learnerInput-${classId}`);
    if (!input.value.trim()) return;
    await api(`/api/teacher/classes/${classId}/learners`, { method: "POST", body: JSON.stringify({ name: input.value }) });
    await loadMyClasses();
    await loadLearners(classId, panel);
    const updated = myClasses.find((c) => c.id === classId);
    if (updated) panel.closest(".card").querySelector(".badge").textContent = `${updated.learner_count} learner${String(updated.learner_count) === "1" ? "" : "s"}`;
  });
  panel.querySelectorAll("[data-learner]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/teacher/learners/${btn.dataset.learner}`, { method: "DELETE" });
      await loadMyClasses();
      await loadLearners(classId, panel);
    });
  });
}

function renderNotifyTab() {
  const holder = document.getElementById("tabContent");
  let scope = "class";
  let audience = "learners";
  let selected = new Set();

  function draw() {
    holder.innerHTML = `
      <div class="card">
        <label style="display:block; margin-bottom:6px;">Send to</label>
        <div style="margin-bottom:14px;">
          <button class="chip ${scope === "class" ? "selected" : ""}" id="scopeClass">One or more classes</button>
          <button class="chip ${scope === "school" ? "selected" : ""}" id="scopeSchool">Entire school</button>
        </div>
        ${scope === "class" ? (myClasses.length === 0
          ? `<p class="muted">Create a class first to notify it.</p>`
          : `<div style="margin-bottom:14px;">${myClasses.map((c) => `<button class="chip ${selected.has(c.id) ? "selected" : ""}" data-class="${c.id}">${escapeHtml(c.name)}</button>`).join("")}</div>`
        ) : ""}
        <label style="display:block; margin-bottom:6px;">Audience</label>
        <div style="margin-bottom:16px;">
          <button class="chip ${audience === "learners" ? "selected" : ""}" id="audLearners">Learners</button>
          <button class="chip ${audience === "parents" ? "selected" : ""}" id="audParents">Parents</button>
          <button class="chip ${audience === "both" ? "selected" : ""}" id="audBoth">Both</button>
        </div>
        <div class="field"><label>Title</label><input id="nTitle" placeholder="Homework reminder" /></div>
        <div class="field"><label>Message</label><textarea id="nBody" rows="3" placeholder="Bring your lab notebook tomorrow."></textarea></div>
        <div id="nErr" class="error" style="display:none;"></div>
        <div id="nSuccess"></div>
        <button class="btn" id="nSendBtn">Send notification</button>
      </div>
      <div id="preview"></div>
    `;
    holder.querySelector("#scopeClass").addEventListener("click", () => { scope = "class"; draw(); });
    holder.querySelector("#scopeSchool").addEventListener("click", () => { scope = "school"; draw(); });
    holder.querySelector("#audLearners").addEventListener("click", () => { audience = "learners"; draw(); });
    holder.querySelector("#audParents").addEventListener("click", () => { audience = "parents"; draw(); });
    holder.querySelector("#audBoth").addEventListener("click", () => { audience = "both"; draw(); });
    holder.querySelectorAll("[data-class]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.class;
        selected.has(id) ? selected.delete(id) : selected.add(id);
        draw();
      });
    });
    document.getElementById("nSendBtn").addEventListener("click", async () => {
      const errEl = document.getElementById("nErr");
      errEl.style.display = "none";
      try {
        const result = await api("/api/teacher/notifications", {
          method: "POST",
          body: JSON.stringify({
            scope,
            audience,
            classIds: Array.from(selected),
            title: document.getElementById("nTitle").value,
            body: document.getElementById("nBody").value,
          }),
        });
        selected = new Set();
        draw();
        document.getElementById("nSuccess").innerHTML = `<p class="success">Delivered to ${result.delivered} of ${result.subscribedDevices} subscribed device${result.subscribedDevices === 1 ? "" : "s"}.</p>`;
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = "block";
      }
    });
    renderPreview();
  }

  async function renderPreview() {
    const previewEl = document.getElementById("preview");
    if (!previewEl) return;
    previewEl.innerHTML = `<p class="muted">"Learners" reaches devices that joined with a class/school code. "Parents" reaches devices that joined with a specific learner's code. Manage codes from the <strong>My classes</strong> tab.</p>`;
  }

  draw();
}

function renderAttendanceTab() {
  const holder = document.getElementById("tabContent");

  if (myClasses.length === 0) {
    holder.innerHTML = `<div class="empty"><h3>No classes yet</h3><p>Create a class first, then come back here to take attendance.</p></div>`;
    return;
  }

  let classId = myClasses[0].id;
  let date = new Date().toISOString().slice(0, 10);
  let statuses = {}; // learnerId -> status, for the currently loaded roster

  function draw() {
    holder.innerHTML = `
      <div class="card">
        <div class="grid cols-2" style="margin-bottom:14px;">
          <div class="field">
            <label>Class</label>
            <select id="attClass">
              ${myClasses.map((c) => `<option value="${c.id}" ${c.id === classId ? "selected" : ""}>${escapeHtml(c.name)} · ${escapeHtml(c.subject)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Date</label>
            <input type="date" id="attDate" value="${date}" />
          </div>
        </div>
        <div id="rosterHolder"><p class="muted">Loading roster…</p></div>
      </div>
      <div class="card">
        <label style="display:block; margin-bottom:8px;">Download report</label>
        <div class="grid cols-3">
          <div class="field">
            <label>Period</label>
            <select id="repPeriod">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div class="field">
            <label>Any date in that period</label>
            <input type="date" id="repDate" value="${date}" />
          </div>
          <div class="field" style="display:flex; align-items:flex-end;">
            <button class="btn" id="downloadBtn" style="width:100%;">Download CSV</button>
          </div>
        </div>
        <div id="repErr" class="error" style="display:none;"></div>
      </div>
    `;

    document.getElementById("attClass").addEventListener("change", (e) => { classId = e.target.value; loadRoster(); });
    document.getElementById("attDate").addEventListener("change", (e) => { date = e.target.value; loadRoster(); });
    document.getElementById("downloadBtn").addEventListener("click", downloadReport);
    loadRoster();
  }

  async function loadRoster() {
    const rosterHolder = document.getElementById("rosterHolder");
    rosterHolder.innerHTML = `<p class="muted">Loading roster…</p>`;
    try {
      const result = await api(`/api/teacher/classes/${classId}/attendance?date=${date}`);
      statuses = {};
      result.roster.forEach((r) => { statuses[r.learner_id] = r.status || "present"; });
      if (result.roster.length === 0) {
        rosterHolder.innerHTML = `<p class="muted">No learners in this class yet. Add some from the My classes tab.</p>`;
        return;
      }
      rosterHolder.innerHTML = `
        <ul class="list">
          ${result.roster.map((r) => `
            <li class="row" data-learner="${r.learner_id}">
              <span>${escapeHtml(r.name)}</span>
              <span>
                <button class="chip status-chip ${statuses[r.learner_id] === "present" ? "selected" : ""}" data-status="present" style="${statuses[r.learner_id] === "present" ? "background:#047857;color:white;border-color:#047857;" : ""}">Present</button>
                <button class="chip status-chip ${statuses[r.learner_id] === "late" ? "selected" : ""}" data-status="late" style="${statuses[r.learner_id] === "late" ? "background:#b45309;color:white;border-color:#b45309;" : ""}">Late</button>
                <button class="chip status-chip ${statuses[r.learner_id] === "absent" ? "selected" : ""}" data-status="absent" style="${statuses[r.learner_id] === "absent" ? "background:#be123c;color:white;border-color:#be123c;" : ""}">Absent</button>
              </span>
            </li>
          `).join("")}
        </ul>
        <div id="attErr" class="error" style="display:none;"></div>
        <div id="attSuccess"></div>
        <button class="btn" id="saveAttBtn" style="margin-top:12px;">Save attendance</button>
      `;
      rosterHolder.querySelectorAll("li").forEach((li) => {
        const learnerId = li.dataset.learner;
        li.querySelectorAll(".status-chip").forEach((chip) => {
          chip.addEventListener("click", () => {
            statuses[learnerId] = chip.dataset.status;
            loadRosterRedraw(li, statuses[learnerId]);
          });
        });
      });
      document.getElementById("saveAttBtn").addEventListener("click", saveAttendance);
    } catch (e) {
      rosterHolder.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    }
  }

  function loadRosterRedraw(li, status) {
    const colors = { present: "#047857", late: "#b45309", absent: "#be123c" };
    li.querySelectorAll(".status-chip").forEach((chip) => {
      if (chip.dataset.status === status) {
        chip.style.background = colors[status];
        chip.style.color = "white";
        chip.style.borderColor = colors[status];
      } else {
        chip.style.background = "";
        chip.style.color = "";
        chip.style.borderColor = "";
      }
    });
  }

  async function saveAttendance() {
    const errEl = document.getElementById("attErr");
    errEl.style.display = "none";
    try {
      const records = Object.keys(statuses).map((learnerId) => ({ learnerId, status: statuses[learnerId] }));
      const result = await api(`/api/teacher/classes/${classId}/attendance`, {
        method: "POST",
        body: JSON.stringify({ date, records }),
      });
      document.getElementById("attSuccess").innerHTML = `<p class="success">Saved. ${result.flagged} parent${result.flagged === 1 ? " was" : "s were"} notified about absence/lateness.</p>`;
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  }

  async function downloadReport() {
    const errEl = document.getElementById("repErr");
    errEl.style.display = "none";
    const period = document.getElementById("repPeriod").value;
    const repDate = document.getElementById("repDate").value;
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/attendance/report?period=${period}&date=${repDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't build that report.");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `attendance-${period}-${repDate}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  }

  draw();
}

async function renderHistoryTab() {
  const holder = document.getElementById("tabContent");
  holder.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const history = await api("/api/teacher/notifications");
    if (history.length === 0) {
      holder.innerHTML = `<div class="empty"><h3>No notifications sent yet</h3><p>Notifications you send will show up here.</p></div>`;
      return;
    }
    const scopeLabel = (n) => (n.scope === "school" ? "Whole school" : n.scope === "learner" ? "One learner" : "Class");
    const audienceLabel = (n) => (n.audience === "both" ? "Learners + parents" : n.audience === "parents" ? "Parents" : "Learners");
    holder.innerHTML = `<div class="card"><ul class="list">` + history.map((n) => `
      <li>
        <div class="row">
          <strong>${escapeHtml(n.title)}</strong>
          <span>
            <span class="badge ${n.scope === "school" ? "amber" : n.scope === "learner" ? "rose" : "green"}">${scopeLabel(n)}</span>
            <span class="badge slate">${audienceLabel(n)}</span>
            ${n.reason === "attendance" ? '<span class="badge rose">Auto: attendance</span>' : ""}
          </span>
        </div>
        <p style="margin:4px 0;">${escapeHtml(n.body)}</p>
        <p class="muted">${new Date(n.created_at).toLocaleString()} · ${n.recipient_count} device${n.recipient_count === 1 ? "" : "s"}</p>
      </li>
    `).join("") + `</ul></div>`;
  } catch (e) {
    holder.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

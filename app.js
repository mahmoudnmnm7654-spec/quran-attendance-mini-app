
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const telegramApp = window.Telegram?.WebApp;
const telegramInitData = telegramApp?.initData || "";

let isTeacher = false;
let isAuthenticated = false;
let me = {};
let data = {teacher: "المعلمة مي", groups: [], records: {}};
let registrationGroups = [];
let selectedGroupId = null;
let currentScreen = "homeScreen";
let pickedStudentStatus = "";
let spinning = false;
let rotation = 0;

const statuses = {
  "حاضرة": "status-present",
  "غائبة": "status-absent",
  "مستمعة": "status-listener",
  "معتذرة": "status-excused"
};

const today = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

function showMessage(message) {
  alert(message);
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function escapeAttr(v) {
  return escapeHtml(v);
}

async function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Telegram-Init-Data": telegramInitData
    }
  });
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.message || "حدث خطأ في الاتصال بالخادم.");
  }
  return result;
}

async function refreshMe() {
  const response = await apiFetch("/api/me");
  me = await readJson(response);
  isTeacher = me.is_teacher === true || me.role === "teacher";
  return me;
}

async function loadTeacherData() {
  const response = await apiFetch("/api/data");
  const serverData = await readJson(response);

  if (!serverData || !Array.isArray(serverData.groups)) {
    throw new Error("بيانات المجموعات غير صحيحة.");
  }

  data = serverData;
  if (!data.records) data.records = {};
  selectedGroupId = data.groups[0]?.id ?? null;
}

async function loadRegistrationGroups() {
  const response = await apiFetch("/api/groups-for-registration");
  const result = await readJson(response);
  registrationGroups = result.groups || [];
}

async function initializeApp() {
  if (!telegramInitData) {
    document.body.innerHTML = `
      <main style="padding:30px;text-align:center;direction:rtl">
        <h2>يرجى فتح التطبيق من داخل Telegram</h2>
        <p>لا يمكن التحقق من الحساب عند فتح الرابط مباشرة.</p>
      </main>`;
    return;
  }

  try {
    await refreshMe();
    isAuthenticated = true;

    if (isTeacher) {
      await loadTeacherData();

      if ($("#attendanceDate")) $("#attendanceDate").value = today();

      renderHome();
      renderGroups();
      renderSelectedGroup();
      fillStudentGroups();
      applyPermissions();
      loadTeacherRequestsButton();
    } else {
      await loadRegistrationGroups();
      applyPermissions();
      renderStudentScreen();
    }

    telegramApp?.ready();
    telegramApp?.expand();

  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main style="padding:30px;text-align:center;direction:rtl">
        <h2>تعذر فتح التطبيق</h2>
        <p>${escapeHtml(error.message)}</p>
        <p>تأكدي من فتح التطبيق من Telegram وأن الخادم يعمل.</p>
      </main>`;
  }
}

function applyPermissions() {
  const teacherButton = $("#teacherMode");
  const studentButton = $("#studentMode");
  const settingsButton = $("#settingsQuick");

  if (teacherButton) teacherButton.classList.toggle("hidden", !isTeacher);
  if (settingsButton) settingsButton.classList.toggle("hidden", !isTeacher);

  if (!isTeacher) {
    teacherButton?.classList.remove("active");
    studentButton?.classList.add("active");
    $$(".bottom-nav").forEach(n => n.classList.add("hidden"));
    showScreen("studentScreen");
  } else {
    teacherButton?.classList.add("active");
    studentButton?.classList.remove("active");
    $$(".bottom-nav").forEach(n => n.classList.remove("hidden"));
    showScreen("homeScreen");
  }
}

async function persist() {
  if (!isAuthenticated || !isTeacher) return false;

  try {
    const response = await apiFetch("/api/data", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data)
    });

    await readJson(response);
    return true;
  } catch (error) {
    console.error(error);
    showMessage(error.message || "تعذر حفظ البيانات.");
    return false;
  }
}

function group() {
  return data.groups.find(g => String(g.id) === String(selectedGroupId)) || data.groups[0];
}

function recordKey() {
  return `${selectedGroupId}_${$("#attendanceDate")?.value || today()}`;
}

function getRecord() {
  if (!data.records[recordKey()]) {
    data.records[recordKey()] = {};
    group()?.students.forEach(n => {
      data.records[recordKey()][n] = "حاضرة";
    });
  }
  return data.records[recordKey()];
}

function showScreen(id) {
  if (!$("#" + id)) return;

  const teacherScreens = [
    "homeScreen", "groupsScreen", "groupScreen",
    "attendanceScreen", "statsScreen", "settingsScreen",
    "manageStudentsScreen"
  ];

  if (!isTeacher && teacherScreens.includes(id)) return;

  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.screen === id));

  currentScreen = id;

  if (id === "groupsScreen") renderGroups();
  if (id === "groupScreen") renderSelectedGroup();
  if (id === "attendanceScreen") renderStudents();
  if (id === "statsScreen") renderStats();
  if (id === "settingsScreen") renderSettings();
  if (id === "manageStudentsScreen") renderManageStudents();

  telegramApp?.expand();
  window.scrollTo({top: 0, behavior: "smooth"});
}

document.addEventListener("click", e => {
  const button = e.target.closest("[data-screen]");
  if (button) {
    e.preventDefault();
    showScreen(button.dataset.screen);
  }
});

$("#settingsQuick")?.addEventListener("click", () => {
  if (isTeacher) showScreen("settingsScreen");
});

function renderHome() {
  if (!isTeacher) return;

  if ($("#homeGroupName")) $("#homeGroupName").textContent = group()?.name || "أضيفي مجموعة";
  if ($("#homeTeacher")) $("#homeTeacher").textContent = data.teacher || "معلمة المجموعة";

  if ($("#homeGroups")) {
    $("#homeGroups").innerHTML = data.groups.slice(0, 3).map(g => `
      <button class="group-card" data-group="${escapeAttr(g.id)}">
        <span class="chev">‹</span>
        <span class="group-emblem">۞</span>
        <span class="group-info">
          <strong>${escapeHtml(g.name)}</strong>
          <small>${g.students.length} طالبة · سجل مستقل</small>
        </span>
      </button>`).join("");
  }
}

function renderGroups() {
  if (!isTeacher || !$("#groupsList")) return;

  $("#groupsList").innerHTML = data.groups.map(g => `
    <button class="group-card" data-group="${escapeAttr(g.id)}">
      <span class="chev">‹</span>
      <span class="group-emblem">۞</span>
      <span class="group-info">
        <strong>${escapeHtml(g.name)}</strong>
        <small>${g.students.length} طالبة · سجل مستقل</small>
      </span>
    </button>`).join("");
}

function renderSelectedGroup() {
  if (!isTeacher) return;
  const g = group();
  if (!g) return;

  if ($("#selectedGroupTitle")) $("#selectedGroupTitle").textContent = g.name;
  if ($("#selectedGroupName")) $("#selectedGroupName").textContent = g.name;
  if ($("#selectedGroupCount")) $("#selectedGroupCount").textContent = `${g.students.length} طالبة`;
}

document.addEventListener("click", e => {
  const button = e.target.closest("[data-group]");
  if (!button || !isTeacher) return;

  selectedGroupId = Number(button.dataset.group);
  renderHome();
  showScreen("groupScreen");
});

function renderStudents() {
  if (!isTeacher) return;

  const g = group();
  if (!g) return;

  const rec = getRecord();
  const q = ($("#studentSearch")?.value || "").trim();

  if (!$("#studentsList")) return;

  $("#studentsList").innerHTML = g.students
    .filter(n => n.includes(q))
    .map(n => `
      <div class="student-row">
        <span class="student-name">${escapeHtml(n)}</span>
        <select class="status-select ${statuses[rec[n] || "حاضرة"]}" data-student="${escapeAttr(n)}">
          ${Object.keys(statuses).map(s => `
            <option ${((rec[n] || "حاضرة") === s) ? "selected" : ""}>${s}</option>
          `).join("")}
        </select>
      </div>`).join("") || '<p class="hint">لا توجد أسماء مطابقة.</p>';

  $$(".status-select").forEach(select => {
    select.onchange = async () => {
      rec[select.dataset.student] = select.value;
      select.className = `status-select ${statuses[select.value]}`;
      updateStatsCounts(rec);
      await persist();
    };
  });

  updateStatsCounts(rec);
}

function updateStatsCounts(rec) {
  if (!rec) return;
  const values = Object.values(rec);
  const count = s => values.filter(v => v === s).length;

  if ($("#presentCount")) $("#presentCount").textContent = count("حاضرة");
  if ($("#absentCount")) $("#absentCount").textContent = count("غائبة");
  if ($("#listenerCount")) $("#listenerCount").textContent = count("مستمعة");
  if ($("#excusedCount")) $("#excusedCount").textContent = count("معتذرة");
  if ($("#totalStudents")) $("#totalStudents").textContent = group()?.students.length || 0;
}

function renderStats() {
  if (isTeacher) updateStatsCounts(getRecord());
}

$("#studentSearch")?.addEventListener("input", renderStudents);
$("#attendanceDate")?.addEventListener("change", renderStudents);

$("#saveAttendance")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  if (await persist()) {
    $("#saveNotice")?.classList.remove("hidden");
    setTimeout(() => $("#saveNotice")?.classList.add("hidden"), 2400);
  }
});

function renderManageStudents() {
  if (!isTeacher) return;

  const select = $("#manageGroupSelect");
  if (!select) return;

  select.innerHTML = data.groups.map(g => `
    <option value="${escapeAttr(g.id)}" ${String(g.id) === String(selectedGroupId) ? "selected" : ""}>
      ${escapeHtml(g.name)}
    </option>`).join("");

  const g = data.groups.find(x => String(x.id) === String(select.value)) || group();

  if ($("#manageStudentsList")) {
    $("#manageStudentsList").innerHTML = g.students.map((n, i) => `
      <div class="manage-row">
        <input data-student-edit="${i}" value="${escapeAttr(n)}">
        <button data-delete-student="${i}">حذف</button>
      </div>`).join("");
  }
}

function fillStudentGroups() {
  const select = $("#manageGroupSelect");
  if (select && isTeacher) renderManageStudents();
}

$("#manageGroupSelect")?.addEventListener("change", () => {
  if (!isTeacher) return;
  selectedGroupId = Number($("#manageGroupSelect").value);
  renderManageStudents();
});

$("#addStudent")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  const name = $("#newStudentName")?.value.trim();
  const g = data.groups.find(x => String(x.id) === String($("#manageGroupSelect")?.value)) || group();

  if (!name) return showMessage("اكتبي اسم الطالبة أولًا.");
  if (g.students.includes(name)) return showMessage("هذا الاسم موجود بالفعل.");

  g.students.push(name);
  selectedGroupId = g.id;

  if (await persist()) {
    $("#newStudentName").value = "";
    renderManageStudents();
    renderHome();
  } else {
    g.students.pop();
  }
});

document.addEventListener("change", async e => {
  const input = e.target.closest("[data-student-edit]");
  if (!input || !isTeacher) return;

  const g = data.groups.find(x => String(x.id) === String($("#manageGroupSelect")?.value)) || group();
  const index = Number(input.dataset.studentEdit);
  const newName = input.value.trim();

  if (!newName) {
    showMessage("لا يمكن ترك اسم الطالبة فارغًا.");
    renderManageStudents();
    return;
  }

  const oldName = g.students[index];
  g.students[index] = newName;

  if (!await persist()) {
    g.students[index] = oldName;
    return;
  }

  renderManageStudents();
  renderHome();
});

document.addEventListener("click", async e => {
  const button = e.target.closest("[data-delete-student]");
  if (!button || !isTeacher) return;

  const g = data.groups.find(x => String(x.id) === String($("#manageGroupSelect")?.value)) || group();
  const index = Number(button.dataset.deleteStudent);
  const removed = g.students.splice(index, 1);

  if (!await persist()) {
    g.students.splice(index, 0, ...removed);
    return;
  }

  renderManageStudents();
  renderHome();
});

$("#teacherMode")?.addEventListener("click", () => {
  if (isTeacher) showScreen("homeScreen");
});

$("#studentMode")?.addEventListener("click", () => {
  if (!isTeacher) showScreen("studentScreen");
});

/* واجهة الطالبة وطلب ربط الحساب */

function studentPanel() {
  return $("#studentScreen")?.querySelector(".student-panel");
}

function renderStudentScreen() {
  if (isTeacher) return;

  if (me.is_student_linked || me.student_linked || me.student) {
    renderLinkedStudent();
  } else if (me.has_pending_request || me.pending_request) {
    renderPendingStudent();
  } else {
    renderStudentRegistration();
  }
}

function renderStudentRegistration() {
  const panel = studentPanel();
  if (!panel) return;

  panel.innerHTML = `
    <h3>ربط حسابكِ بالحضور القرآني 🌷</h3>
    <p class="hint">اختاري مجموعتكِ واكتبي اسمكِ كما سجلته المعلمة. سيصل طلبكِ للمعلمة للموافقة.</p>

    <label for="studentGroupSelect">المجموعة القرآنية</label>
    <select id="studentGroupSelect">
      <option value="">اختاري المجموعة</option>
      ${registrationGroups.map(g => `
        <option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>
      `).join("")}
    </select>

    <label for="studentNameSelect">اسمكِ الكامل</label>
    <input id="studentNameSelect" type="text" placeholder="اكتبي اسمكِ كما هو مسجل">

    <button class="primary-btn" id="requestStudentLink">إرسال طلب الربط</button>
    <p class="hint">لن تتمكني من تسجيل الحضور قبل موافقة المعلمة.</p>
  `;

  $("#requestStudentLink")?.addEventListener("click", sendStudentRequest);
}

async function sendStudentRequest() {
  const groupId = $("#studentGroupSelect")?.value;
  const studentName = $("#studentNameSelect")?.value.trim();
  const button = $("#requestStudentLink");

  if (!groupId) return showMessage("اختاري المجموعة أولًا.");
  if (!studentName) return showMessage("اكتبي اسمكِ كما سجلته المعلمة.");

  button.disabled = true;
  button.textContent = "جارٍ إرسال الطلب...";

  try {
    const response = await apiFetch("/api/student/request", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        group_id: groupId,
        student_name: studentName
      })
    });

    await readJson(response);
    await refreshMe();
    renderStudentScreen();
  } catch (error) {
    showMessage(error.message);
    button.disabled = false;
    button.textContent = "إرسال طلب الربط";
  }
}

function renderPendingStudent() {
  const panel = studentPanel();
  if (!panel) return;

  const name = me.pending_request?.student_name || me.student_name || "";

  panel.innerHTML = `
    <div style="text-align:center;padding:20px 8px">
      <div style="font-size:42px">⏳</div>
      <h3>طلبكِ قيد المراجعة</h3>
      <p> ${name ? `الاسم: ${escapeHtml(name)}` : "وصل طلب ربط حسابكِ للمعلمة."}</p>
      <p class="hint">انتظري موافقة المعلمة، ثم اضغطي على تحديث الحالة.</p>
      <button class="primary-btn" id="refreshStudentLink">تحديث الحالة</button>
    </div>
  `;

  $("#refreshStudentLink")?.addEventListener("click", async () => {
    try {
      await refreshMe();
      renderStudentScreen();
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function renderLinkedStudent() {
  const panel = studentPanel();
  if (!panel) return;

  const student = me.student || {};
  const name = student.name || me.student_name || "الطالبة";
  const groupName = student.group_name || me.group_name || "";

  panel.innerHTML = `
    <div style="text-align:center;padding:12px 8px">
      <div style="font-size:38px">🌷</div>
      <h3>أهلًا بكِ ${escapeHtml(name)}</h3>
      <p class="hint">${escapeHtml(groupName)}</p>
      <p>اختاري حالتكِ لهذا اليوم:</p>

      <div class="student-status-choices">
        ${Object.entries(statuses).map(([status, cls]) => `
          <button type="button" class="status-choice ${cls}" data-status="${status}">
            ${status}
          </button>
        `).join("")}
      </div>

      <button class="primary-btn" id="submitStudentStatus">تأكيد الحالة</button>
    </div>
  `;

  $$(".status-choice", panel).forEach(button => {
    button.addEventListener("click", () => {
      pickedStudentStatus = button.dataset.status;
      $$(".status-choice", panel).forEach(b => {
        b.classList.toggle("selected", b === button);
      });
    });
  });

  $("#submitStudentStatus")?.addEventListener("click", submitStudentStatus);
}

async function submitStudentStatus() {
  if (!pickedStudentStatus) {
    return showMessage("اختاري حالتكِ أولًا.");
  }

  const button = $("#submitStudentStatus");
  button.disabled = true;

  try {
    const response = await apiFetch("/api/student/status", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({status: pickedStudentStatus})
    });

    await readJson(response);
    showMessage("تم تسجيل حالتكِ بنجاح 🌷");
    pickedStudentStatus = "";
    button.disabled = false;
  } catch (error) {
    showMessage(error.message);
    button.disabled = false;
  }
}

/* طلبات ربط الطالبات لدى المعلمة */

function loadTeacherRequestsButton() {
  if (!isTeacher || !$("#homeScreen")) return;

  let button = $("#openLinkRequests");
  if (!button) {
    button = document.createElement("button");
    button.id = "openLinkRequests";
    button.className = "primary-btn";
    button.textContent = "طلبات ربط الطالبات";
    button.style.margin = "12px 0";
    $("#homeScreen").prepend(button);
  }

  button.onclick = showTeacherRequests;
}

async function showTeacherRequests() {
  if (!isTeacher) return;

  try {
    const response = await apiFetch("/api/teacher/requests");
    const result = await readJson(response);
    const requests = result.requests || [];

    let panel = $("#teacherRequestsPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "teacherRequestsPanel";
      panel.className = "panel";
      $("#homeScreen").appendChild(panel);
    }

    panel.innerHTML = `
      <h3>طلبات ربط الطالبات</h3>
      ${requests.length ? requests.map(r => `
        <div class="student-row" style="display:block;margin:12px 0;padding:12px">
          <strong>${escapeHtml(r.student_name)}</strong>
          <p>${escapeHtml(r.group_name || r.group_id || "")}</p>
          <p class="hint">حساب Telegram: ${escapeHtml(r.telegram_user_id || "")}</p>
          <button class="primary-btn" data-approve-request="${escapeAttr(r.id)}">موافقة</button>
          <button class="secondary-btn" data-reject-request="${escapeAttr(r.id)}">رفض</button>
        </div>
      `).join("") : '<p class="hint">لا توجد طلبات ربط جديدة.</p>'}
      <button class="secondary-btn" id="refreshTeacherRequests">تحديث الطلبات</button>
    `;

    $("#refreshTeacherRequests")?.addEventListener("click", showTeacherRequests);
  } catch (error) {
    showMessage(error.message);
  }
}

document.addEventListener("click", async e => {
  const approve = e.target.closest("[data-approve-request]");
  const reject = e.target.closest("[data-reject-request]");

  if (!isTeacher) return;

  if (approve) {
    approve.disabled = true;
    try {
      const id = approve.dataset.approveRequest;
      const response = await apiFetch(`/api/teacher/requests/${encodeURIComponent(id)}/approve`, {
        method: "POST"
      });
      await readJson(response);
      showMessage("تمت الموافقة وربط حساب الطالبة.");
      await showTeacherRequests();
    } catch (error) {
      showMessage(error.message);
      approve.disabled = false;
    }
  }

  if (reject) {
    if (!confirm("هل تريدين رفض طلب الربط؟")) return;

    reject.disabled = true;
    try {
      const id = reject.dataset.rejectRequest;
      const response = await apiFetch(`/api/teacher/requests/${encodeURIComponent(id)}/reject`, {
        method: "POST"
      });
      await readJson(response);
      showMessage("تم رفض الطلب.");
      await showTeacherRequests();
    } catch (error) {
      showMessage(error.message);
      reject.disabled = false;
    }
  }
});

/* الإعدادات وإدارة المجموعات */

function renderSettings() {
  if (!isTeacher) return;

  if ($("#teacherName")) $("#teacherName").value = data.teacher || "";

  if ($("#groupEditors")) {
    $("#groupEditors").innerHTML = data.groups.map(g => `
      <div class="editor-row">
        <input data-edit-group="${escapeAttr(g.id)}" value="${escapeAttr(g.name)}" aria-label="اسم المجموعة">
        <button data-delete-group="${escapeAttr(g.id)}" title="حذف المجموعة">حذف</button>
      </div>`).join("");
  }
}

$("#addGroupSetting")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  const name = $("#newGroupName")?.value.trim();
  if (!name) return $("#newGroupName")?.focus();

  const id = Date.now();
  data.groups.push({id, name, students: []});
  selectedGroupId = id;

  if (await persist()) {
    $("#newGroupName").value = "";
    renderSettings();
    renderHome();
    renderGroups();
  } else {
    data.groups = data.groups.filter(g => g.id !== id);
  }
});

$("#addGroup")?.addEventListener("click", () => {
  if (!isTeacher) return;
  showScreen("settingsScreen");
  $("#newGroupName")?.focus();
});

document.addEventListener("click", async e => {
  const button = e.target.closest("[data-delete-group]");
  if (!button || !isTeacher) return;

  if (data.groups.length === 1) {
    showMessage("يجب إبقاء مجموعة واحدة على الأقل.");
    return;
  }

  if (!confirm("هل تريدين حذف هذه المجموعة؟")) return;

  const id = Number(button.dataset.deleteGroup);
  const oldGroups = [...data.groups];
  const oldSelected = selectedGroupId;

  data.groups = data.groups.filter(g => Number(g.id) !== id);
  if (Number(selectedGroupId) === id) selectedGroupId = data.groups[0].id;

  if (!await persist()) {
    data.groups = oldGroups;
    selectedGroupId = oldSelected;
    return;
  }

  renderSettings();
  renderHome();
  renderGroups();
  renderSelectedGroup();
});

$("#saveSettings")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  data.teacher = $("#teacherName")?.value.trim() || "المعلمة";

  $$("[data-edit-group]").forEach(input => {
    const g = data.groups.find(x => String(x.id) === String(input.dataset.editGroup));
    if (g && input.value.trim()) g.name = input.value.trim();
  });

  if (await persist()) {
    renderHome();
    renderGroups();
    renderSelectedGroup();
    showMessage("تم حفظ الإعدادات على الخادم.");
  }
});

/* الرسائل التشجيعية */

$("#makeMessage")?.addEventListener("click", () => {
  if (!isTeacher) return;

  const name = $("#messageStudent")?.value.trim() || "يا صاحبة القرآن";
  const msg = $("#messageText")?.value.trim() ||
    "واصلي طريق النور، فكل حرف تحفظينه رفعة وأجر بإذن الله.";

  const output = `إلى ${name} 🌷\n\n${msg}\n\nزادكِ الله ثباتًا وبركةً مع القرآن الكريم 💚`;

  if ($("#messagePreview")) {
    $("#messagePreview").textContent = output;
    $("#messagePreview").classList.remove("hidden");
  }
});

/* عجلة المسابقات */

const wheelTopics = [
  "كمل السورة التالية",
  "المتشابهات",
  "أحكام التجويد",
  "بنك الحظ",
  "سؤال ذكائي واسم السورة",
  "انت وحظك",
  "تحدي جماعي"
];

$("#spinWheel")?.addEventListener("click", () => {
  if (spinning || !$("#wheel")) return;

  spinning = true;
  const idx = Math.floor(Math.random() * wheelTopics.length);
  rotation += 1440 + idx * (360 / wheelTopics.length) + Math.random() * 30;

  $("#wheel").style.transform = `rotate(${rotation}deg)`;
  if ($("#wheelResult")) $("#wheelResult").textContent = "العجلة تدور...";
  $("#spinWheel").disabled = true;

  setTimeout(() => {
    if ($("#wheelResult")) {
      $("#wheelResult").textContent = `✨ التحدي المختار: ${wheelTopics[idx]}`;
    }
    $("#spinWheel").disabled = false;
    spinning = false;
  }, 3300);
});

initializeApp();

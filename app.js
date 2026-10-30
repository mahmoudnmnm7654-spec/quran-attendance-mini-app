
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const telegramApp = window.Telegram?.WebApp;
const telegramInitData = telegramApp?.initData || "";

let isTeacher = false;
let isAuthenticated = false;

async function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Telegram-Init-Data": telegramInitData
    }
  });
}

const statuses = {
  "حاضرة": "status-present",
  "غائبة": "status-absent",
  "مستمعة": "status-listener",
  "معتذرة": "status-excused"
};

const defaultData = {
  teacher: "المعلمة مي",
  groups: [
    {id: 1, name: "مجموعة الفجر", students: ["فاطمة أحمد","مريم علي","سارة خالد","نورهان مصطفى","آية محمد","رغد حسن","ليا إبراهيم","جود سامي"]},
    {id: 2, name: "مجموعة النور", students: ["آية محمود","سلمى أحمد","رؤى خالد","جنى محمد"]},
    {id: 3, name: "مجموعة الإتقان", students: ["مريم حسن","نور علي","سارة محمود"]},
    {id: 4, name: "مجموعة الخاتمات", students: ["فاطمة علي","رنا أحمد","هبة محمد","شهد خالد"]}
  ],
  records: {}
};

let data = structuredClone(defaultData);
let selectedGroupId = 1;
let currentScreen = "homeScreen";
let pickedStudentStatus = "";
let spinning = false;
let rotation = 0;

const today = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

function showMessage(message) {
  alert(message);
}

function applyPermissions() {
  const teacherButton = $("#teacherMode");
  const studentButton = $("#studentMode");
  const settingsButton = $("#settingsQuick");

  if (teacherButton) teacherButton.classList.toggle("hidden", !isTeacher);
  if (settingsButton) settingsButton.classList.toggle("hidden", !isTeacher);

  if (!isTeacher) {
    if (studentButton) studentButton.classList.add("active");
    teacherButton?.classList.remove("active");
    showScreen("studentScreen");
  } else {
    if (teacherButton) teacherButton.classList.add("active");
    studentButton?.classList.remove("active");
    showScreen("homeScreen");
  }
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
    const meResponse = await apiFetch("/api/me");

    if (!meResponse.ok) {
      throw new Error("تعذر التحقق من حساب Telegram.");
    }

    const me = await meResponse.json();
    isAuthenticated = true;
    isTeacher = me.is_teacher === true;

    const dataResponse = await apiFetch("/api/data");

    if (!dataResponse.ok) {
      throw new Error("تعذر تحميل بيانات المجموعات.");
    }

    const serverData = await dataResponse.json();

    if (serverData && Array.isArray(serverData.groups)) {
      data = serverData;
    } else {
      const saved = localStorage.getItem("quranAttendanceData");
      if (saved) {
        try {
          const localData = JSON.parse(saved);
          if (isTeacher && localData && Array.isArray(localData.groups)) {
            data = localData;
          }
        } catch {
          data = structuredClone(defaultData);
        }
      }
    }

    if (!Array.isArray(data.groups) || data.groups.length === 0) {
      data = structuredClone(defaultData);
    }

    selectedGroupId = data.groups[0]?.id || 1;

    $("#attendanceDate").value = today();

    renderHome();
    renderGroups();
    renderSelectedGroup();
    fillStudentGroups();

    applyPermissions();

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

async function persist() {
  localStorage.setItem("quranAttendanceData", JSON.stringify(data));

  if (!isAuthenticated || !isTeacher) {
    return false;
  }

  try {
    const response = await apiFetch("/api/data", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error("رفض الخادم حفظ البيانات.");
    }

    return true;
  } catch (error) {
    console.error("تعذر حفظ البيانات:", error);
    showMessage("تعذر حفظ البيانات على الخادم. تحققي من الاتصال.");
    return false;
  }
}

function group() {
  return data.groups.find(g => g.id === selectedGroupId) || data.groups[0];
}

function recordKey() {
  return `${selectedGroupId}_${$("#attendanceDate").value || today()}`;
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
    "homeScreen",
    "groupsScreen",
    "groupScreen",
    "attendanceScreen",
    "statsScreen",
    "settingsScreen",
    "manageStudentsScreen"
  ];

  if (!isTeacher && teacherScreens.includes(id)) {
    return;
  }

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
  const b = e.target.closest("[data-screen]");
  if (b) {
    e.preventDefault();
    showScreen(b.dataset.screen);
  }
});

$("#settingsQuick")?.addEventListener("click", () => {
  if (isTeacher) showScreen("settingsScreen");
});

function renderHome() {
  $("#homeGroupName").textContent = group()?.name || "أضيفي مجموعة";
  $("#homeTeacher").textContent = data.teacher || "معلمة المجموعة";

  $("#homeGroups").innerHTML = data.groups.slice(0, 3).map(g => `
    <button class="group-card" data-group="${g.id}">
      <span class="chev">‹</span>
      <span class="group-emblem">۞</span>
      <span class="group-info">
        <strong>${escapeHtml(g.name)}</strong>
        <small>${g.students.length} طالبة · سجل مستقل</small>
      </span>
    </button>`).join("");
}

function renderGroups() {
  $("#groupsList").innerHTML = data.groups.map(g => `
    <button class="group-card" data-group="${g.id}">
      <span class="chev">‹</span>
      <span class="group-emblem">۞</span>
      <span class="group-info">
        <strong>${escapeHtml(g.name)}</strong>
        <small>${g.students.length} طالبة · سجل مستقل</small>
      </span>
    </button>`).join("");
}

function renderSelectedGroup() {
  const g = group();
  if (!g) return;

  $("#selectedGroupTitle").textContent = g.name;
  $("#selectedGroupName").textContent = g.name;
  $("#selectedGroupCount").textContent = `${g.students.length} طالبة`;
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-group]");
  if (!b || !isTeacher) return;

  selectedGroupId = Number(b.dataset.group);
  renderHome();
  showScreen("groupScreen");
});

function renderStudents() {
  if (!isTeacher) return;

  const g = group();
  if (!g) return;

  const rec = getRecord();
  const q = ($("#studentSearch").value || "").trim();

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

  $$(".status-select").forEach(s => {
    s.onchange = async () => {
      rec[s.dataset.student] = s.value;
      s.className = `status-select ${statuses[s.value]}`;
      updateStatsCounts(rec);
      await persist();
    };
  });

  updateStatsCounts(rec);
}

function updateStatsCounts(rec) {
  const values = Object.values(rec);
  const count = s => values.filter(v => v === s).length;

  $("#presentCount").textContent = count("حاضرة");
  $("#absentCount").textContent = count("غائبة");
  $("#listenerCount").textContent = count("مستمعة");
  $("#excusedCount").textContent = count("معتذرة");
  $("#totalStudents").textContent = group()?.students.length || 0;
}

function renderStats() {
  if (!isTeacher) return;
  updateStatsCounts(getRecord());
}

$("#studentSearch")?.addEventListener("input", renderStudents);
$("#attendanceDate")?.addEventListener("change", renderStudents);

$("#saveAttendance")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  const saved = await persist();
  if (saved) {
    $("#saveNotice").classList.remove("hidden");
    setTimeout(() => $("#saveNotice").classList.add("hidden"), 2400);
  }
});

function renderManageStudents() {
  if (!isTeacher) return;

  const sel = $("#manageGroupSelect");
  if (!sel) return;

  sel.innerHTML = data.groups.map(g => `
    <option value="${g.id}" ${g.id === selectedGroupId ? "selected" : ""}>
      ${escapeHtml(g.name)}
    </option>`).join("");

  const g = data.groups.find(x => x.id === Number(sel.value)) || group();

  $("#manageStudentsList").innerHTML = g.students.map((n, i) => `
    <div class="manage-row">
      <input data-student-edit="${i}" value="${escapeAttr(n)}">
      <button data-delete-student="${i}">حذف</button>
    </div>`).join("");
}

function fillStudentGroups() {
  const a = $("#studentGroupSelect");
  const b = $("#manageGroupSelect");

  if (a) {
    a.innerHTML = data.groups.map(g => `
      <option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  }

  if (a) fillStudentNames();
  if (b && isTeacher) renderManageStudents();
}

function fillStudentNames() {
  const sel = $("#studentNameSelect");
  if (!sel) return;

  const g = data.groups.find(x => x.id === Number($("#studentGroupSelect").value)) || data.groups[0];

  sel.innerHTML = (g?.students || []).map(n => `
    <option>${escapeHtml(n)}</option>`).join("");
}

$("#manageGroupSelect")?.addEventListener("change", () => {
  if (!isTeacher) return;
  selectedGroupId = Number($("#manageGroupSelect").value);
  renderManageStudents();
});

$("#studentGroupSelect")?.addEventListener("change", fillStudentNames);

$("#addStudent")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  const n = $("#newStudentName").value.trim();
  const g = data.groups.find(x => x.id === Number($("#manageGroupSelect").value)) || group();

  if (!n) return showMessage("اكتبي اسم الطالبة أولًا.");
  if (g.students.includes(n)) return showMessage("هذا الاسم موجود بالفعل.");

  g.students.push(n);
  selectedGroupId = g.id;

  if (await persist()) {
    $("#newStudentName").value = "";
    renderManageStudents();
    renderHome();
    fillStudentGroups();
  }
});

document.addEventListener("change", async e => {
  const inp = e.target.closest("[data-student-edit]");
  if (!inp || !isTeacher) return;

  const g = data.groups.find(x => x.id === Number($("#manageGroupSelect").value)) || group();
  const i = Number(inp.dataset.studentEdit);

  if (inp.value.trim()) {
    const oldName = g.students[i];
    g.students[i] = inp.value.trim();

    if (!await persist()) {
      g.students[i] = oldName;
      return;
    }

    renderManageStudents();
    renderHome();
    fillStudentGroups();
  }
});

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-delete-student]");
  if (!b || !isTeacher) return;

  const g = data.groups.find(x => x.id === Number($("#manageGroupSelect").value)) || group();
  const i = Number(b.dataset.deleteStudent);
  const removed = g.students.splice(i, 1);

  if (!await persist()) {
    g.students.splice(i, 0, ...removed);
    return;
  }

  renderManageStudents();
  renderHome();
  fillStudentGroups();
});

$("#teacherMode")?.addEventListener("click", () => {
  if (!isTeacher) return;

  $("#teacherMode").classList.add("active");
  $("#studentMode").classList.remove("active");
  showScreen("homeScreen");
});

$("#studentMode")?.addEventListener("click", () => {
  $("#studentMode").classList.add("active");
  $("#teacherMode")?.classList.remove("active");
  fillStudentGroups();
  showScreen("studentScreen");
});

$$(".status-choice").forEach(b => {
  b.addEventListener("click", () => {
    pickedStudentStatus = b.dataset.status;
    $$(".status-choice").forEach(x => x.classList.toggle("selected", x === b));
  });
});

$("#submitStudentStatus")?.addEventListener("click", () => {
  showMessage("تسجيل حضور الطالبات سيُفعّل بعد ربط حساب Telegram بكل طالبة والتحقق من هويتها. لم نسجل اسمًا بالنيابة عن طالبة أخرى.");
});

function renderSettings() {
  if (!isTeacher) return;

  $("#teacherName").value = data.teacher || "";

  $("#groupEditors").innerHTML = data.groups.map(g => `
    <div class="editor-row">
      <input data-edit-group="${g.id}" value="${escapeAttr(g.name)}" aria-label="اسم المجموعة">
      <button data-delete-group="${g.id}" title="حذف المجموعة">حذف</button>
    </div>`).join("");
}

$("#addGroupSetting")?.addEventListener("click", () => {
  if (!isTeacher) return;

  const name = $("#newGroupName").value.trim();
  if (!name) {
    $("#newGroupName").focus();
    return;
  }

  addGroup(name);
  $("#newGroupName").value = "";
  renderSettings();
});

$("#addGroup")?.addEventListener("click", () => {
  if (!isTeacher) return;
  showScreen("settingsScreen");
  $("#newGroupName").focus();
});

async function addGroup(name) {
  if (!isTeacher) return;

  const id = Date.now();
  data.groups.push({id, name, students: []});
  selectedGroupId = id;

  if (await persist()) renderHome();
}

document.addEventListener("click", async e => {
  const del = e.target.closest("[data-delete-group]");
  if (!del || !isTeacher) return;

  const id = Number(del.dataset.deleteGroup);

  if (data.groups.length === 1) {
    showMessage("يجب إبقاء مجموعة واحدة على الأقل.");
    return;
  }

  if (!confirm("هل تريدين حذف هذه المجموعة؟")) return;

  const oldGroups = [...data.groups];
  data.groups = data.groups.filter(g => g.id !== id);

  if (selectedGroupId === id) selectedGroupId = data.groups[0].id;

  if (!await persist()) {
    data.groups = oldGroups;
    return;
  }

  renderSettings();
  renderHome();
});

$("#saveSettings")?.addEventListener("click", async () => {
  if (!isTeacher) return;

  data.teacher = $("#teacherName").value.trim() || "المعلمة";

  $$("[data-edit-group]").forEach(i => {
    const g = data.groups.find(x => x.id === Number(i.dataset.editGroup));
    if (g && i.value.trim()) g.name = i.value.trim();
  });

  const newName = $("#newGroupName").value.trim();
  if (newName) {
    data.groups.push({id: Date.now(), name: newName, students: []});
    $("#newGroupName").value = "";
  }

  if (await persist()) {
    renderHome();
    renderGroups();
    renderSelectedGroup();
    fillStudentGroups();
    showMessage("تم حفظ الإعدادات على الخادم.");
  }
});

$("#makeMessage")?.addEventListener("click", () => {
  if (!isTeacher) return;

  const name = $("#messageStudent").value.trim() || "يا صاحبة القرآن";
  const msg = $("#messageText").value.trim() || "واصلي طريق النور، فكل حرف تحفظينه رفعة وأجر بإذن الله.";

  const out = `إلى ${name} 🌷\n\n${msg}\n\nزادكِ الله ثباتًا وبركةً مع القرآن الكريم 💚`;

  $("#messagePreview").textContent = out;
  $("#messagePreview").classList.remove("hidden");
});

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
  if (spinning) return;

  spinning = true;

  const idx = Math.floor(Math.random() * wheelTopics.length);
  rotation += 1440 + idx * (360 / wheelTopics.length) + Math.random() * 30;

  $("#wheel").style.transform = `rotate(${rotation}deg)`;
  $("#wheelResult").textContent = "العجلة تدور...";
  $("#spinWheel").disabled = true;

  setTimeout(() => {
    $("#wheelResult").textContent = `✨ التحدي المختار: ${wheelTopics[idx]}`;
    $("#spinWheel").disabled = false;
    spinning = false;
  }, 3300);
});

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
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

initializeApp();

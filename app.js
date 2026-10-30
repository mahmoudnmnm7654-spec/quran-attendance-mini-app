const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const statuses = {
  "حاضرة": "status-present",
  "غائبة": "status-absent",
  "مستمعة": "status-listener",
  "معتذرة": "status-excused"
};
const defaultData = {
  teacher:"المعلمة مي",
  groups:[
    {id:1,name:"مجموعة الفجر",students:["فاطمة أحمد","مريم علي","سارة خالد","نورهان مصطفى","آية محمد","رغد حسن","ليا إبراهيم","جود سامي"]},
    {id:2,name:"مجموعة النور",students:["آية محمود","سلمى أحمد","رؤى خالد","جنى محمد"]},
    {id:3,name:"مجموعة الإتقان",students:["مريم حسن","نور علي","سارة محمود"]},
    {id:4,name:"مجموعة الخاتمات",students:["فاطمة علي","رنا أحمد","هبة محمد","شهد خالد"]}
  ],
  records:{}
};
let data;
try { data = JSON.parse(localStorage.getItem("quranAttendanceData")) || structuredClone(defaultData); } catch { data=structuredClone(defaultData); }
let selectedGroupId=data.groups[0]?.id || 1;
let currentScreen="homeScreen";
const today=()=>new Date().toISOString().slice(0,10);
$("#attendanceDate").value=today();
function persist(){
  localStorage.setItem("quranAttendanceData", JSON.stringify(data));

  fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(error => {
    console.error("تعذر حفظ البيانات على الخادم:", error);
  });
}
function group(){return data.groups.find(g=>g.id===selectedGroupId)||data.groups[0];}
function recordKey(){return `${selectedGroupId}_${$("#attendanceDate").value||today()}`;}
function getRecord(){if(!data.records[recordKey()]){data.records[recordKey()]={};group()?.students.forEach((n,i)=>data.records[recordKey()][n]=["حاضرة","حاضرة","مستمعة","غائبة","حاضرة","معتذرة","حاضرة","حاضرة"][i%8]);}return data.records[recordKey()];}
function showScreen(id){
  if(!$( "#"+id)) return;
  $$(".screen").forEach(s=>s.classList.toggle("active",s.id===id));
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
  currentScreen=id;
  if(id==="groupsScreen") renderGroups();
  if(id==="groupScreen") renderSelectedGroup();
  if(id==="attendanceScreen") renderStudents();
  if(id==="statsScreen") renderStats();
  if(id==="settingsScreen") renderSettings();
  if(id==="manageStudentsScreen") renderManageStudents();
  if(window.Telegram?.WebApp){try{Telegram.WebApp.expand();}catch{}}
  window.scrollTo({top:0,behavior:"smooth"});
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-screen]");
  if(b){e.preventDefault();showScreen(b.dataset.screen);}
});
$("#settingsQuick").onclick=()=>showScreen("settingsScreen");
function renderHome(){
  $("#homeGroupName").textContent=group()?.name||"أضيفي مجموعة";
  $("#homeTeacher").textContent=data.teacher||"معلمة المجموعة";
  $("#homeGroups").innerHTML=data.groups.slice(0,3).map(g=>`<button class="group-card" data-group="${g.id}"><span class="chev">‹</span><span class="group-emblem">۞</span><span class="group-info"><strong>${escapeHtml(g.name)}</strong><small>${g.students.length} طالبة · سجل مستقل</small></span></button>`).join("");
}
function renderGroups(){
 $("#groupsList").innerHTML=data.groups.map(g=>`<button class="group-card" data-group="${g.id}"><span class="chev">‹</span><span class="group-emblem">۞</span><span class="group-info"><strong>${escapeHtml(g.name)}</strong><small>${g.students.length} طالبة · سجل مستقل</small></span></button>`).join("");
}
function renderSelectedGroup(){
 const g=group();if(!g)return;
 $("#selectedGroupTitle").textContent=g.name;$("#selectedGroupName").textContent=g.name;$("#selectedGroupCount").textContent=`${g.students.length} طالبة`;
}
document.addEventListener("click",e=>{
 const b=e.target.closest("[data-group]");if(!b)return;
 selectedGroupId=Number(b.dataset.group);renderHome();showScreen("groupScreen");
});
function renderStudents(){
 const g=group();if(!g)return;
 const rec=getRecord(),q=($("#studentSearch").value||"").trim();
 $("#studentsList").innerHTML=g.students.filter(n=>n.includes(q)).map(n=>`<div class="student-row"><span class="student-name">${escapeHtml(n)}</span><select class="status-select ${statuses[rec[n]||"حاضرة"]}" data-student="${escapeAttr(n)}">${Object.keys(statuses).map(s=>`<option ${((rec[n]||"حاضرة")===s)?"selected":""}>${s}</option>`).join("")}</select></div>`).join("")||'<p class="hint">لا توجد أسماء مطابقة.</p>';
 $$(".status-select").forEach(s=>s.onchange=()=>{rec[s.dataset.student]=s.value;s.className=`status-select ${statuses[s.value]}`;updateStatsCounts(rec);});
 updateStatsCounts(rec);
}
function updateStatsCounts(rec){
 const values=Object.values(rec);
 const count=s=>values.filter(v=>v===s).length;
 $("#presentCount").textContent=count("حاضرة");$("#absentCount").textContent=count("غائبة");$("#listenerCount").textContent=count("مستمعة");$("#excusedCount").textContent=count("معتذرة");
 $("#totalStudents").textContent=group()?.students.length||0;
}
function renderStats(){const rec=getRecord();updateStatsCounts(rec);}
$("#studentSearch").addEventListener("input",renderStudents);
$("#attendanceDate").addEventListener("change",renderStudents);
$("#saveAttendance").onclick=()=>{persist();$("#saveNotice").classList.remove("hidden");setTimeout(()=>$("#saveNotice").classList.add("hidden"),2400);};
function renderManageStudents(){
 const sel=$("#manageGroupSelect"); if(!sel)return;
 sel.innerHTML=data.groups.map(g=>`<option value="${g.id}" ${g.id===selectedGroupId?"selected":""}>${escapeHtml(g.name)}</option>`).join("");
 const g=data.groups.find(x=>x.id===Number(sel.value))||group();
 $("#manageStudentsList").innerHTML=g.students.map((n,i)=>`<div class="manage-row"><input data-student-edit="${i}" value="${escapeAttr(n)}"><button data-delete-student="${i}">حذف</button></div>`).join("");
}
function fillStudentGroups(){
 const a=$("#studentGroupSelect"), b=$("#manageGroupSelect");
 if(a)a.innerHTML=data.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
 if(a)fillStudentNames(); if(b)renderManageStudents();
}
function fillStudentNames(){const sel=$("#studentNameSelect");if(!sel)return;const g=data.groups.find(x=>x.id===Number($("#studentGroupSelect").value))||data.groups[0];sel.innerHTML=(g?.students||[]).map(n=>`<option>${escapeHtml(n)}</option>`).join("");}
$("#manageGroupSelect")?.addEventListener("change",()=>{selectedGroupId=Number($("#manageGroupSelect").value);renderManageStudents();});
$("#studentGroupSelect")?.addEventListener("change",fillStudentNames);
$("#addStudent")?.addEventListener("click",()=>{const n=$("#newStudentName").value.trim();const g=data.groups.find(x=>x.id===Number($("#manageGroupSelect").value))||group();if(!n)return alert("اكتبي اسم الطالبة أولًا.");if(g.students.includes(n))return alert("هذا الاسم موجود بالفعل.");g.students.push(n);selectedGroupId=g.id;persist();$("#newStudentName").value="";renderManageStudents();renderHome();fillStudentGroups();});
document.addEventListener("change",e=>{const inp=e.target.closest("[data-student-edit]");if(!inp)return;const g=data.groups.find(x=>x.id===Number($("#manageGroupSelect").value))||group();const i=Number(inp.dataset.studentEdit);if(inp.value.trim()){g.students[i]=inp.value.trim();persist();renderManageStudents();renderHome();fillStudentGroups();}});
document.addEventListener("click",e=>{const b=e.target.closest("[data-delete-student]");if(!b)return;const g=data.groups.find(x=>x.id===Number($("#manageGroupSelect").value))||group();g.students.splice(Number(b.dataset.deleteStudent),1);persist();renderManageStudents();renderHome();fillStudentGroups();});
let pickedStudentStatus="";
$("#teacherMode")?.addEventListener("click",()=>{ $("#teacherMode").classList.add("active");$("#studentMode").classList.remove("active");showScreen("homeScreen");});
$("#studentMode")?.addEventListener("click",()=>{ $("#studentMode").classList.add("active");$("#teacherMode").classList.remove("active");fillStudentGroups();showScreen("studentScreen");});
$$(".status-choice").forEach(b=>b.addEventListener("click",()=>{pickedStudentStatus=b.dataset.status;$$(".status-choice").forEach(x=>x.classList.toggle("selected",x===b));}));
$("#submitStudentStatus")?.addEventListener("click",()=>{const name=$("#studentNameSelect").value;const gid=Number($("#studentGroupSelect").value);if(!name)return alert("أضيفي أسماء الطالبات أولًا من واجهة المعلمة.");if(!pickedStudentStatus)return alert("اختاري حالتكِ أولًا.");const k=`${gid}_${today()}`;if(!data.records[k])data.records[k]={};data.records[k][name]=pickedStudentStatus;persist();$("#studentConfirm").textContent=`بارك الله فيكِ يا ${name} 🌷 تم تسجيل حالتكِ: ${pickedStudentStatus}`;$("#studentConfirm").classList.remove("hidden");});
function renderSettings(){
 $("#teacherName").value=data.teacher||"";
 $("#groupEditors").innerHTML=data.groups.map(g=>`<div class="editor-row"><input data-edit-group="${g.id}" value="${escapeAttr(g.name)}" aria-label="اسم المجموعة"><button data-delete-group="${g.id}" title="حذف المجموعة">حذف</button></div>`).join("");
}
$("#addGroupSetting").onclick=()=>{const name=$("#newGroupName").value.trim();if(!name){$("#newGroupName").focus();return;}addGroup(name);$("#newGroupName").value="";renderSettings();};
$("#addGroup").onclick=()=>{showScreen("settingsScreen");$("#newGroupName").focus();};
function addGroup(name){const id=Date.now();data.groups.push({id,name,students:[]});selectedGroupId=id;persist();renderHome();}
document.addEventListener("click",e=>{
 const del=e.target.closest("[data-delete-group]");if(!del)return;
 const id=Number(del.dataset.deleteGroup);if(data.groups.length===1){alert("يجب إبقاء مجموعة واحدة على الأقل.");return;}
 if(!confirm("هل تريدين حذف هذه المجموعة؟"))return;
 data.groups=data.groups.filter(g=>g.id!==id);if(selectedGroupId===id)selectedGroupId=data.groups[0].id;persist();renderSettings();renderHome();
});
$("#saveSettings").onclick=()=>{
 data.teacher=$("#teacherName").value.trim()||"المعلمة";
 $$("[data-edit-group]").forEach(i=>{const g=data.groups.find(x=>x.id===Number(i.dataset.editGroup));if(g&&i.value.trim())g.name=i.value.trim();});
 const newName=$("#newGroupName").value.trim();if(newName){addGroup(newName);$("#newGroupName").value="";}
 persist();renderHome();renderGroups();renderSelectedGroup();fillStudentGroups();alert("تم حفظ الإعدادات على هذا الجهاز.");
};
$("#makeMessage").onclick=()=>{
 const name=$("#messageStudent").value.trim()||"يا صاحبة القرآن";const msg=$("#messageText").value.trim()||"واصلي طريق النور، فكل حرف تحفظينه رفعة وأجر بإذن الله.";
 const out=`إلى ${name} 🌷\n\n${msg}\n\nزادكِ الله ثباتًا وبركةً مع القرآن الكريم 💚`;
 $("#messagePreview").textContent=out;$("#messagePreview").classList.remove("hidden");
};
const wheelTopics=["حفظ القرآن الكريم","مراجعة وتسميع","تحديات قرآنية","معاني الآيات","أحكام التجويد","معلومات قرآنية"];
let spinning=false,rotation=0;
$("#spinWheel").onclick=()=>{
 if(spinning)return;spinning=true;
 const idx=Math.floor(Math.random()*wheelTopics.length);rotation+=1440+idx*60+Math.random()*30;
 $("#wheel").style.transform=`rotate(${rotation}deg)`;$("#wheelResult").textContent="العجلة تدور...";$("#spinWheel").disabled=true;
 setTimeout(()=>{$("#wheelResult").textContent=`✨ التحدي المختار: ${wheelTopics[idx]}`;$("#spinWheel").disabled=false;spinning=false;},3300);
};
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function escapeAttr(v){return escapeHtml(v);}
renderHome();renderGroups();renderSelectedGroup();fillStudentGroups();
if(window.Telegram?.WebApp){try{Telegram.WebApp.ready();Telegram.WebApp.expand();}catch{}}

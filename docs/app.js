// 연구비 집행 점검: 규칙 판정·사례 검색 모두 브라우저에서 처리 (서버·LLM 호출 없음)
const $ = (s) => document.querySelector(s);
const RANK = { 인정: 0, 판단필요: 1, 불인정: 2 };
const LABEL = { 인정: "집행할 수 있어요", 판단필요: "확인이 필요해요", 불인정: "이대로는 집행할 수 없어요" };
const ico = (d) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SEAL = { 인정: ico('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), 판단필요: ico('<path d="M12 7v6"/><path d="M12 17h.01"/>'), 불인정: ico('<path d="M7 7l10 10M17 7L7 17"/>') };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tag = (v) => `<span class="tag" data-v="${v}">${v}</span>`;
const grams = (s) => { s = s.replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const where = (doc, p) => (/산업기술혁신|운영요령/.test(doc) && !/POSTECH/.test(doc) ? `HWP 원문 ${p}구간` : `PDF ${p}쪽`); // 운영요령은 HWP라 쪽 대신 추출 구간
const cite = (g) => `${g.문서} ${g.조항} (${where(g.문서, g.쪽)})`;

// 날짜: 숫자만 쳐도 2026-10-09 형태로 맞춰 줌 (type=date는 연도 칸이 6자리라 숫자 연속 입력이 안 됨)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function maskDate(el) {
  const d = el.value.replace(/\D/g, "").slice(0, 8);
  el.value = d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
  el.setAttribute("aria-invalid", el.value.length === 10 && !dateOf("#" + el.id));
}
function dateOf(sel) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec($(sel).value);
  if (!m) return null;
  const d = new Date(+m[1], m[2] - 1, +m[3]);
  return d.getMonth() === m[2] - 1 && d.getDate() === +m[3] ? d : null; // 2026-02-30 같은 날짜 거름
}

// 소관 부처 → 판정 트랙(national: 혁신법 공통, motie: 산업부 특례, private: 정부 외) + 대표 전문기관
const MINISTRIES = [
  ["과학기술정보통신부", "한국연구재단·IITP 등", "national"], ["교육부", "한국연구재단", "national"],
  ["산업통상부", "KEIT·KIAT 등", "motie"], ["중소벤처기업부", "TIPA", "national"], ["보건복지부", "KHIDI", "national"],
  ["기후에너지환경부", "KETEP·KEITI", "national"], ["국토교통부", "KAIA", "national"], ["해양수산부", "KIMST", "national"],
  ["농림축산식품부", "IPET", "national"], ["농촌진흥청", "", "national"], ["식품의약품안전처", "", "national"],
  ["질병관리청", "", "national"], ["우주항공청", "", "national"], ["원자력안전위원회", "", "national"],
  ["문화체육관광부", "KOCCA", "national"], ["행정안전부", "", "national"], ["기상청", "", "national"],
  ["산림청", "", "national"], ["경찰청", "", "national"], ["소방청", "", "national"], ["국가유산청", "", "national"],
  ["고용노동부", "", "national"], ["방위사업청", "국방연구개발", "national"],
];
const COMMON = [
  { 이름: "국가연구개발혁신법·시행령", url: "https://www.law.go.kr/법령/국가연구개발혁신법" },
  { 이름: "국가연구개발사업 연구개발비 사용 기준 (과기정통부 고시, 전 부처 공통)", url: "https://www.law.go.kr/행정규칙/국가연구개발사업 연구개발비 사용 기준" },
];

let D, rule = null, filter = null, page = 0, matched = [], lastV = null;

fetch("data.json").then((r) => r.json()).then((d) => {
  D = d;
  D.cases.forEach((c) => (c.g = grams(c.제목 + " " + c.답변.slice(0, 160))));
  D.rules.forEach((r) => (r.g = grams(r.항목 + " " + r.keywords.join(" "))));
  $("#meta").textContent = `규정 기준일 ${D.meta.기준일} · 규정 ${D.meta.문서.length}종 · 사례 ${D.meta.사례수.toLocaleString()}건`;
  $("#track").innerHTML = `<optgroup label="국가연구개발사업">${MINISTRIES.map(([m, a]) => `<option value="${m}">${m}${a ? ` (${a})` : ""}</option>`).join("")}</optgroup>
    <optgroup label="정부 외"><option value="__private">산업체·POSCO·기타 민간과제</option><option value="__internal">교내 연구개발과제(교비)</option></optgroup>`;
  renderRegs();
  renderCases(null);
  const groups = [...new Set(D.rules.map((r) => r.비목))];
  $("#itemSel").insertAdjacentHTML("beforeend", groups.map((g) => `<optgroup label="${esc(g)}">${D.rules.filter((r) => r.비목 === g)
    .map((r) => `<option value="${r.id}">${esc(r.항목)}</option>`).join("")}</optgroup>`).join(""));
  $("#quick").innerHTML = ["회의비(식비 포함)", "국외 출장비", "컴퓨터·프린터 등 범용 사무기기", "연구장비 구입·임차", "학생인건비 지급", "전문가 활용비(자문료·강사료·원고료)"]
    .map((n) => `<li><button type="button">${n}</button></li>`).join("");
  $("#spend").value = ymd(new Date());
  fromHash();
});
function fromHash() {
  const r = D.rules.find((r) => r.id === decodeURIComponent(location.hash.slice(1)));
  if (r && r !== rule) { $("#item").value = ""; setRule(r); }
}
addEventListener("hashchange", fromHash);

// 입력 문구 → 가장 가까운 규칙
function findRule(q) {
  q = q.trim();
  if (!q) return null;
  const exact = D.rules.find((r) => r.항목 === q);
  if (exact) return exact;
  const g = grams(q);
  let best = null, score = 0;
  for (const r of D.rules) {
    let s = 0; g.forEach((x) => r.g.has(x) && s++);
    if (r.keywords.some((k) => q.includes(k) || k.includes(q))) s += 3;
    if (s > score) { best = r; score = s; }
  }
  return score >= 2 ? best : null;
}

// 키워드 입력 → 가장 가까운 항목을 목록에서도 선택
function pick() {
  const q = $("#item").value.trim();
  setRule(q ? findRule(q) : D.rules.find((r) => r.id === $("#itemSel").value) || null);
}

function setRule(r) {
  $("#itemSel").value = r ? r.id : "";
  if (r !== rule) {
    rule = r;
    $("#qs").innerHTML = "<legend>해당하면 체크</legend>" + (r
      ? r.questions.map((q) => `<label><input type="checkbox" data-q="${q.id}">${esc(q.label)}</label>`).join("")
      : `<p class="none">항목을 고르면 확인할 질문이 나옵니다.</p>`);
    if (r) history.replaceState(null, "", "#" + r.id);
  }
  run();
}

function fields() {
  const n = (id) => { const v = $(id).value.replace(/,/g, ""); return v === "" ? null : Number(v); };
  const m = $("#track").value, f = { ministry: m, track: trackOf(m), amount: n("#amount"), people: n("#people") };
  f.perPerson = f.amount != null && f.people ? f.amount / f.people : null;
  const s = dateOf("#spend"), e = dateOf("#end");
  f.daysToEnd = s && e ? Math.round((e - s) / 864e5) : null;
  rule?.questions.forEach((q) => (f[q.id] = !!$(`[data-q="${q.id}"]`)?.checked));
  return f;
}

const OPS = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };
const hit = (when, f) => when.every(([k, op, v]) => f[k] !== null && f[k] !== undefined && OPS[op](f[k], v));

// 협약변경: 필요한 변경과 사용자가 입력한 상태를 대조
function agreement(f) {
  const need = rule.agree.filter((a) => hit(a.when, f));
  const done = !$("#agreeBox").hidden && document.querySelector('[name="ag"]:checked').value === "done";
  const agDate = dateOf("#agDate"), spend = dateOf("#spend");
  const future = spend && spend > new Date();
  const out = need.map((a) => {
    let v = "인정", msg = `${a.유형} 완료 확인`;
    if (!done) {
      v = a.유형 === "통보" ? "판단필요" : future ? "판단필요" : "불인정";
      msg = a.유형 === "통보" ? "집행 전후 통보(시스템 등록)가 필요합니다" : future ? "집행 전에 승인을 받아야 합니다" : "승인 없이 집행하면 불인정됩니다";
    } else if (a.유형 !== "통보" && agDate && spend && agDate > spend) {
      v = "불인정"; msg = "승인일이 집행일보다 늦습니다(사전 승인 원칙)";
    }
    return { ...a, v, msg };
  });
  return out;
}

function run() {
  $("#agDateWrap").hidden = document.querySelector('[name="ag"]:checked').value !== "done";
  $("#agreeBox").hidden = !rule || !rule.agree.some((a) => hit(a.when, fields()));
  if (!rule) {
    $("#empty").hidden = false; $("#verdict").hidden = true;
    if ($("#item").value.trim()) $("#empty .lead").textContent = "일치하는 항목이 없습니다. 목록에서 고르거나 다른 말로 입력하세요.";
    return renderCases(null);
  }
  const f = fields();
  const hits = rule.checks.filter((c) => hit(c.when, f));
  const ag = agreement(f);
  const all = [...hits.map((h) => h.판정), ...ag.map((a) => a.v)];
  const v = all.reduce((m, x) => (RANK[x] > RANK[m] ? x : m), "인정");

  $("#empty").hidden = true; $("#verdict").hidden = false;
  const seal = $("#seal");
  if (seal.dataset.v !== v) { seal.classList.remove("stamp"); void seal.offsetWidth; seal.classList.add("stamp"); }
  seal.dataset.v = v; $("#sealText").innerHTML = SEAL[v];
  $("#what").innerHTML = `<b>${esc(rule.항목)}</b> · ${esc(regLine(f.ministry))}`;
  $("#vTitle").textContent = LABEL[v];
  $("#seal").setAttribute("aria-label", { 인정: "적정", 판단필요: "확인 필요", 불인정: "부적정" }[v]);

  // 근거 순서: 산업부는 공통 운영요령 → 혁신법, 그 외 국가R&D는 혁신법 → POSTECH, 민간은 POSTECH 먼저
  const pri = { motie: ["산업기술혁신", "혁신법", "POSTECH"], national: ["혁신법", "NRF", "POSTECH"], private: ["POSTECH"] }[f.track];
  const ord = (gs) => [...gs].sort((a, b) => rankDoc(a.문서, pri) - rankDoc(b.문서, pri));
  const items = [
    ...hits.sort((a, b) => RANK[b.판정] - RANK[a.판정]).map((h) => ({ v: h.판정, t: h.사유, g: ord(h.근거) })),
    ...ag.filter((a) => a.v !== "인정").map((a) => ({ v: a.v, t: `협약변경(${a.유형}): ${a.내용}. ${a.msg}.`, g: ord(a.근거) })),
  ];
  if (!items.length) items.push({ v: "인정", t: rule.base.사유, g: ord(rule.base.근거) });
  const row = (x, i) => `<li data-v="${x.v}">${tag(x.v)}<span>${esc(x.t)}</span>
      <span class="src"><button type="button" data-law="${i}">${esc(cite(x.g[0]))}</button>${x.g.length > 1 ? ` 외 ${x.g.length - 1}건` : ""}</span>
      ${x.g[0].발췌 ? `<q class="ex">${esc(x.g[0].발췌)}</q>` : ""}</li>`;
  // 화면에 들어가는 만큼만 보이고 나머지는 '더 보기'로 (페이지 스크롤 없음)
  const ol = $("#reasons");
  let n = items.length;
  ol.innerHTML = items.map(row).join("");
  while (n > 1 && ol.scrollHeight > ol.clientHeight) {
    n--;
    ol.innerHTML = items.slice(0, n).map(row).join("") + `<li class="more"><button type="button" id="moreReasons">사유 ${items.length - n}건 더 보기</button></li>`;
  }
  $("#reasons").onclick = (e) => {
    if (e.target.dataset.law) showLaw(items[+e.target.dataset.law].g);
    if (e.target.id === "moreReasons") openDlg(`<h3>${esc(rule.항목)} 판정 사유</h3><ol>${items.map((x) => `<li>${tag(x.v)} ${esc(x.t)}<br><small>${x.g.map(cite).map(esc).join(" / ")}</small></li>`).join("")}</ol>`);
  };
  $("#evid").innerHTML = rule.증빙.map((e) => `<li>${esc(e)}</li>`).join("");
  $("#agSummary").innerHTML = ag.length
    ? ag.map((a) => `<p>${tag(a.v)} <b>${a.유형}</b> ${esc(a.내용)}</p>`).join("")
    : `<p class="hint">입력한 조건에서는 협약변경이 필요하지 않습니다.</p>`;

  renderAgreeTab(ag);
  renderLawTab([rule.base, ...hits]);
  renderCases(v);
}

// 사례: 규칙 비목·키워드와 입력어로 관련도 계산
function renderCases(v = lastV) {
  lastV = v;
  const q = $("#item").value.trim() || rule?.항목 || "";
  if (!D) return;
  const g = grams(q + " " + (rule ? rule.keywords.join(" ") : ""));
  // 참고자료(공식 문서) 우선, 그 안에서 관련도 순
  const motie = trackOf($("#track").value) === "motie";
  matched = q ? D.cases.filter((c) => !(motie && /NRF/.test(c.출처))).map((c) => {
    let s = 0; g.forEach((x) => c.g.has(x) && s++);
    if (rule && c.비목 === rule.비목) s += 4;
    if (motie && /산업기술혁신/.test(c.출처)) s += 4; // 산업부 과제는 공통 운영요령 우선
    return [s, c];
  }).filter(([s]) => s >= 6).sort((a, b) => (a[1].판정 === "참고") - (b[1].판정 === "참고") || (b[1].출처구분 === "참고자료") - (a[1].출처구분 === "참고자료") || b[0] - a[0]).map(([, c]) => c) : [];
  const cnt = { 인정: 0, 불인정: 0, 판단필요: 0, 참고: 0 };
  matched.forEach((c) => cnt[c.판정]++);
  $("#tabCases").textContent = `사례 ${matched.length}`;
  $("#dist").innerHTML = ["인정", "불인정", "판단필요", "참고"].map((k) =>
    `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${tag(k)}<b>${cnt[k]}</b></button>`).join("");
  if (v) {
    $("#casesHint").innerHTML = matched.length
      ? `<span class="pill">비슷한 사례 <b>${matched.length}</b></span>${["인정", "불인정", "판단필요", "참고"].map((k) => `<span class="pill" data-v="${k}">${k} <b>${cnt[k]}</b></span>`).join("")}${v === "인정" && cnt.불인정 ? `<span class="warn-note">불인정 사례가 있어요. 조건을 한 번 더 확인하세요.</span>` : ""}`
      : `<span class="pill">비슷한 사례를 찾지 못했어요</span>`;
  }
  page = 0; drawCards();
}

function drawCards() {
  const list = filter ? matched.filter((c) => c.판정 === filter) : matched;
  const box = $("#cards");
  // 화면 높이에 맞춰 한 쪽 카드 수 계산 (스크롤 없이)
  box.innerHTML = list.length ? `<li><button class="probe"><span class="line">${tag("인정")}</span><span class="t">가<br>가<br>가</span><span class="w">가</span></button></li>` : "";
  const h = box.firstElementChild?.offsetHeight || 88;
  const per = Math.max(2, Math.floor((box.clientHeight + 7) / (h + 7)));
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages - 1);
  box.innerHTML = list.length ? list.slice(page * per, page * per + per).map((c) => `<li><button type="button" data-id="${c.id}">
      <span class="line">${tag(c.판정)}<span class="src-tag">${esc(c.출처구분 === "참고자료" ? c.출처.replace(/\(.*\)/, "") : c.출처구분)}</span>${c.자동 ? `<span class="src-tag auto" title="키워드로 자동 분류된 게시판 글입니다. 원문 답변을 꼭 확인하세요.">자동분류</span>` : ""}<span class="w">${c.원문URL ? "" : where(c.출처, c.쪽)}</span></span>
      <span class="t" title="${esc(c.제목)}">${esc(c.제목)}</span><span class="w">${esc(c.비목)} · ${esc(c.판정근거)}</span></button></li>`).join("")
    : `<li class="nothing">${rule ? "조건에 맞는 사례가 없습니다." : "항목을 입력하면 참고자료·게시판의 관련 사례가 나옵니다."}</li>`;
  $("#pageInfo").textContent = `${list.length ? page + 1 : 0} / ${list.length ? pages : 0}`;
  $("#prev").disabled = page === 0; $("#next").disabled = page >= pages - 1;
}

function showCase(c) {
  openDlg(`<p>${tag(c.판정)} <span class="src-tag">${esc(c.출처)}</span> <span class="w">${c.원문URL ? `<a href="${esc(c.원문URL)}" target="_blank" rel="noopener">원문 보기</a>` : `${where(c.출처, c.쪽)} · ${esc(c.유형)}`}</span></p>
    <h3>${esc(c.제목)}</h3><div class="body">${esc(c.답변)}</div>
    <p class="why">${c.자동 ? `자동 분류(키워드 “${esc(c.판정근거)}” 기준)입니다. 원문 답변으로 판단하세요.` : `${esc(c.판정근거.replace(/^검수: /, "판정 이유: "))}`}<br>판정이 원문과 다르면 연구지원팀에 알려 주세요.</p>`);
}

function renderAgreeTab(ag) {
  const all = rule.agree;
  $("#pAgree").innerHTML = all.length
    ? `<p class="hint">이 항목과 관련된 협약변경 기준입니다. 입력 조건에 해당하는 항목은 판정 표지가 붙습니다.</p><ul class="agl">${all.map((a) => {
        const m = ag.find((x) => x.내용 === a.내용);
        return `<li data-t="${a.유형}"><span class="d">${a.유형} ${m ? tag(m.v) : ""}</span><br>${esc(a.내용)}${m ? `<br><small>${esc(m.msg)}</small>` : ""}<br><span class="ref">${a.근거.map(cite).map(esc).join(" / ")}</span></li>`;
      }).join("")}</ul>`
    : `<p class="hint">이 항목은 협약변경 대상이 아닙니다. 단, 연구개발비 총액·연도별 금액이 바뀌면 '비목 간 예산 변경(전용)' 항목을 확인하세요.</p>`;
  // IRIS FAQ의 협약변경 절차 안내(운영단 작성) 중 관련 높은 것
  const g = grams(rule.항목 + " " + rule.keywords.join(" ") + " " + all.map((a) => a.내용).join(" "));
  const howto = D.cases.filter((c) => c.유형 === "FAQ" && /협약\s?변경/.test(c.제목))
    .map((c) => { let s = 0; g.forEach((x) => c.g.has(x) && s++); return [s, c]; })
    .sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, c]) => c);
  if (all.length && howto.length)
    $("#pAgree").insertAdjacentHTML("beforeend", `<p class="hint" style="margin-top:.8rem"><b>IRIS 신청 절차 안내</b></p><ul class="agl">${howto.map((c) =>
      `<li><a href="${esc(c.원문URL)}" target="_blank" rel="noopener">${esc(c.제목)}</a></li>`).join("")}</ul>`);
}

const rankDoc = (doc, pri) => { const i = pri.findIndex((k) => doc.includes(k)); return i < 0 ? 9 : i; };
const trackOf = (m) => (m.startsWith("__") ? "private" : MINISTRIES.find((x) => x[0] === m)?.[2] || "national");
function regLine(m) {
  if (m === "__private") return "지원기관 협약서 + POSTECH 연구비관리지침";
  if (m === "__internal") return "POSTECH 연구개발과제 운영지침";
  return trackOf(m) === "motie" ? `${m} · 산업기술혁신사업 공통 운영요령 우선 + 혁신법 공통` : `${m} · 혁신법 공통 기준`;
}

// 적용 규정 탭: 상위법 → 공통 고시 → 부처 규정 → POSTECH 내규 순
function renderRegs() {
  if (!D) return;
  const m = $("#track").value, li = (r, note = "") => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.이름)}</a>${r.시행일 ? ` <span class="ref">시행 ${r.시행일.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3")}</span>` : ""}${note}</li>`;
  const postech = `<li>POSTECH 연구비관리지침·여비규정·계약규정 <span class="ref">지원기관 규정에 없는 사항, 더 엄격한 경우 적용</span></li>`;
  let html;
  if (m === "__private") html = `<ol class="agl"><li>지원기관과 맺은 연구계약(협약)서</li>${postech}</ol>`;
  else if (m === "__internal") html = `<ol class="agl"><li>POSTECH 연구개발과제 운영지침</li>${postech}</ol>`;
  else {
    const own = (D.ministries[m] || []).slice(0, 5);
    const applied = trackOf(m) === "motie" ? "산업부 과제는 산업기술혁신사업 공통 운영요령을 먼저 적용합니다(최소 인건비계상률 10%, 같은 기관 사람끼리 회의 식비 불가, 개인별 연구수당 70% 한도, 협약변경 승인 목록 등). NRF 사례집은 산업부 과제에 쓰지 않습니다." :
      "판정은 혁신법 공통 기준과 POSTECH 내규로 합니다. 아래 부처·사업 규정에 별도 기준이 있으면 그것이 우선하니 해당 사업 규정을 함께 확인하세요.";
    html = `<p class="hint">${esc(applied)}</p><ol class="agl">${COMMON.map((r) => li(r)).join("")}
      ${own.length ? own.map((r) => li(r)).join("") : `<li>${esc(m)} 소관 별도 연구개발비 규정 없음(법제처 검색 기준). 사업 공고문·협약서의 특약을 확인하세요.</li>`}
      ${postech}</ol>${m === "방위사업청" ? `<p class="hint"><b>국방연구개발사업</b>은 「국방연구개발사업 출연금의 지급·사용 및 관리에 관한 고시」가 우선 적용됩니다.</p>` : ""}`;
  }
  $("#pRegs").innerHTML = html;
  if (rule) run();
}

function renderLawTab(list) {
  const seen = new Set(), gs = list.flatMap((x) => x.근거).filter((g) => !seen.has(cite(g)) && seen.add(cite(g)));
  $("#pLaw").innerHTML = `<ul class="law">${gs.map((g) => `<li><span class="d">${esc(cite(g))}</span><q>${esc(g.발췌 || "")}</q></li>`).join("")}</ul>`;
}

function showLaw(gs) {
  openDlg(`<h3>근거 원문</h3><ul class="law">${gs.map((g) => `<li><span class="d">${esc(cite(g))}</span><q style="-webkit-line-clamp:unset">${esc(g.발췌)}</q></li>`).join("")}</ul>`);
}

function openDlg(html) { $("#dlgBody").innerHTML = html; $("#dlg").showModal(); }

function tab(name) {
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  $("#pCases").hidden = name !== "cases"; $("#pRegs").hidden = name !== "regs"; $("#pAgree").hidden = name !== "agree"; $("#pLaw").hidden = name !== "law";
  if (name === "cases") drawCards();
}

// 이벤트
$("#form").addEventListener("input", (e) => {
  if (e.target.classList.contains("date")) maskDate(e.target);
  if (e.target.id === "amount") { // 숫자만 남기고 천 단위 콤마
    const d = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    e.target.value = d ? Number(d).toLocaleString("ko-KR") : "";
  }
  if (e.target.id === "item") return pick();
  run();
});
$("#track").addEventListener("change", () => { renderRegs(); if (!rule) renderCases(null); });
$("#itemSel").addEventListener("change", () => { $("#item").value = ""; setRule(D.rules.find((r) => r.id === $("#itemSel").value) || null); });
// 달력 버튼: 숨은 date 입력의 기본 달력을 열고, 고른 날짜를 글자 칸에 넣음
$("#form").addEventListener("click", (e) => {
  const b = e.target.closest(".cal"); if (!b) return;
  const text = b.previousElementSibling, pick = b.nextElementSibling;
  pick.value = dateOf("#" + text.id) ? text.value : "";
  pick.onchange = () => { text.value = pick.value; maskDate(text); run(); };
  try { pick.showPicker(); } catch { text.focus(); }
});
$("#form").addEventListener("submit", (e) => e.preventDefault());
$("#quick").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") { $("#item").value = ""; setRule(findRule(e.target.textContent)); } });
$("#dist").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = filter === b.dataset.f ? null : b.dataset.f; renderCases(); });
$("#cards").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) showCase(D.cases.find((c) => c.id === b.dataset.id)); });
$("#prev").onclick = () => { page--; drawCards(); };
$("#next").onclick = () => { page++; drawCards(); };
document.querySelector(".tabs").addEventListener("click", (e) => e.target.dataset.tab && tab(e.target.dataset.tab));
addEventListener("resize", () => drawCards());

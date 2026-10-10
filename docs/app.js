// 연구비 집행 점검: 규칙 판정·사례 검색 모두 브라우저에서 처리 (서버·LLM 호출 없음)
const $ = (s) => document.querySelector(s);
const RANK = { 인정: 0, 판단필요: 1, 불인정: 2 };
const LABEL = { 인정: "집행할 수 있어요", 판단필요: "확인이 필요해요", 불인정: "이대로는 집행할 수 없어요" };
const LABEL_M = { 인정: "진행할 수 있어요", 판단필요: "확인이 필요해요", 불인정: "이대로는 진행할 수 없어요" }; // 정산·협약변경
const lab = (v) => (rule?.구분 === "관리" ? LABEL_M : LABEL)[v];
const ico = (d) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SEAL = { 인정: ico('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), 판단필요: ico('<path d="M12 7v6"/><path d="M12 17h.01"/>'), 불인정: ico('<path d="M7 7l10 10M17 7L7 17"/>') };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tag = (v) => `<span class="tag" data-v="${v}">${v}</span>`;
const grams = (s) => { s = s.replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const where = (doc, p) => (/산업기술혁신|운영요령/.test(doc) && !/POSTECH/.test(doc) ? `HWP 원문 ${p}구간` : `PDF ${p}쪽`); // 운영요령은 HWP라 쪽 대신 추출 구간
const cite = (g) => `${g.문서} ${g.조항} (${g.출처 === "법제처" ? "법제처 현행" : where(g.문서, g.쪽)})`;

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

fetch("data.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
  D = d;
  D.cases.forEach((c) => (c.g = grams(c.제목 + " " + c.답변.slice(0, 160))));
  D.rules.forEach((r) => (r.g = grams(r.항목 + " " + r.keywords.join(" "))));
  $("#meta").textContent = `규정 기준일 ${D.meta.기준일} · 규정 ${D.meta.문서.length}종 · 사례 ${D.meta.사례수.toLocaleString()}건`;
  $("#track").innerHTML = `<optgroup label="국가연구개발사업">${MINISTRIES.map(([m, a]) => `<option value="${m}">${m}${a ? ` (${a})` : ""}</option>`).join("")}</optgroup>
    <optgroup label="정부 외"><option value="__private">산업체·POSCO·기타 민간과제</option><option value="__internal">교내 연구개발과제(교비)</option></optgroup>`;
  renderRegs();
  renderCases(null);
  fillItems();
  $("#quick").innerHTML = ["회의비(식비 포함)", "국외 출장비", "컴퓨터·프린터 등 범용 사무기기", "연구장비 구입·임차", "학생인건비 지급", "전문가 활용비(자문료·강사료·원고료)"]
    .map((n) => `<li><button type="button">${n}</button></li>`).join("");
  $("#spend").value = ymd(new Date());
  fromHash();
});
function fromHash() {
  const r = D.rules.find((r) => r.id === decodeURIComponent(location.hash.slice(1)));
  if (r && r !== rule) setRule(r);
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

// 확인 질문: 선택한 부처(과제 구분)에 적용되는 것만 표시, 이미 체크한 값은 유지
function renderQs() {
  const m = $("#track").value, t = trackOf(m), on = new Set([...document.querySelectorAll("[data-q]:checked")].map((x) => x.dataset.q));
  const qs = rule ? rule.questions.filter((q) => q.tracks.includes(t) && (!q.ministries || q.ministries.includes(m))) : [];
  $("#qs").innerHTML = "<legend>해당하면 체크</legend>" + (rule
    ? qs.map((q) => `<label><input type="checkbox" data-q="${q.id}"${on.has(q.id) ? " checked" : ""}>${esc(q.label)}</label>`).join("") || `<p class="none">이 과제 구분에서는 추가로 확인할 사항이 없어요.</p>`
    : `<p class="none">항목을 고르면 확인할 질문이 나옵니다.</p>`);
}

// 입력칸: 항목마다 판정에 필요한 정보만 해당 항목의 이름으로 보여 줌(항목 미선택 시 기본 4칸)
const INPUTS = { amount: "금액(원)", people: "인원", spend: "집행일", end: "과제 종료일" };
function renderInputs() {
  const spec = rule?.inputs || INPUTS;
  for (const id in INPUTS) {
    const f = $("#" + id).closest(".field");
    f.hidden = !(id in spec);
    f.firstChild.nodeValue = spec[id] || INPUTS[id];
  }
  document.querySelectorAll("#form .row").forEach((r) => (r.hidden = ![...r.querySelectorAll(".field")].some((f) => !f.hidden)));
}
const shown = (id) => !$(id).closest(".field").hidden;

// 점검 종류: 집행 항목(비목별 지출)과 정산·협약변경(이월·간접비 증액·예산 변경·책임자 변경·결제수단)을 나눠 목록 구성
const modeOf = (r) => (r.구분 === "관리" ? "manage" : "spend");
const curMode = () => document.querySelector('[name="mode"]:checked').value;
function fillItems() {
  const m = curMode(), rs = D.rules.filter((r) => modeOf(r) === m);
  $("#itemLbl").textContent = m === "spend" ? "무엇을 집행하나요?" : "무엇을 확인하나요?";
  $("#scopeQ").placeholder = m === "spend" ? "예: 주류, 택시, 중고 장비, 소급" : "예: 이자, 연구수당, 학생인건비, 파견";
  $("#itemSel").innerHTML = `<option value="">목록에서 고르세요</option>` + [...new Set(rs.map((r) => r.비목))].map((g) => `<optgroup label="${esc(g)}">${rs.filter((r) => r.비목 === g)
    .map((r) => `<option value="${r.id}">${esc(r.항목)}</option>`).join("")}</optgroup>`).join("");
  $("#itemSel").value = rule && modeOf(rule) === m ? rule.id : "";
}

function setRule(r) {
  if (r && modeOf(r) !== curMode()) { document.querySelector(`[name="mode"][value="${modeOf(r)}"]`).checked = true; fillItems(); }
  $("#itemSel").value = r ? r.id : "";
  if (r !== rule) {
    rule = r; autoQ = null;
    renderInputs();
    renderQs();
    if (r) history.replaceState(null, "", "#" + r.id);
  }
  run();
}

function fields() {
  const n = (id) => { const v = $(id).value.replace(/,/g, ""); return v === "" || !shown(id) ? null : Number(v); };
  const m = $("#track").value, f = { ministry: m, track: trackOf(m), amount: n("#amount"), people: n("#people") };
  f.perPerson = f.amount != null && f.people ? f.amount / f.people : null;
  const s = shown("#spend") && dateOf("#spend"), e = shown("#end") && dateOf("#end");
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
  $("#vTitle").textContent = lab(v);
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

// 사례 범위: 선택한 부처 과제에 해당하는 사례만 (NRF 사례집은 과기정통부·교육부, 산업부 운영요령은 산업부, 혁신법 매뉴얼 등은 국가R&D 공통)
function caseFits(c) {
  const m = $("#track").value;
  if (m.startsWith("__")) return /^POSTECH/.test(c.출처); // 민간·교내과제: 학내 규정만
  return c.부처.includes("공통") || c.부처.includes(m);
}

// 사례: 규칙 비목·키워드와 입력어로 관련도 계산
function renderCases(v = lastV) {
  lastV = v;
  const q = rule?.항목 || "";
  if (!D) return;
  const g = grams(q + " " + (rule ? rule.keywords.join(" ") : ""));
  // 참고자료(공식 문서) 우선, 그 안에서 관련도 순
  const motie = trackOf($("#track").value) === "motie";
  matched = q ? D.cases.filter(caseFits).map((c) => {
    let s = 0; g.forEach((x) => c.g.has(x) && s++);
    if (rule && c.비목 === rule.비목) s += 4;
    if (motie && /산업기술혁신/.test(c.출처)) s += 4; // 산업부 과제는 공통 운영요령 우선
    return [s, c];
  }).filter(([s]) => s >= 6).sort((a, b) => (a[1].판정 === "참고") - (b[1].판정 === "참고") || (b[1].출처구분 === "참고자료") - (a[1].출처구분 === "참고자료") || b[0] - a[0]).map(([, c]) => c) : [];
  // 항목과 관련된 사례(판정 요약용) → 사례 검색어로 한 번 더 거름. 항목이 없으면 전체 사례에서 검색
  const base = matched, cntOf = (l) => { const n = { 인정: 0, 불인정: 0, 판단필요: 0, 참고: 0 }; l.forEach((c) => n[c.판정]++); return n; };
  const words = (s) => s.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const has = (c, ws) => { const t = (c.제목 + " " + c.답변 + " " + c.비목 + " " + c.출처).toLowerCase(); return ws.every((w) => t.includes(w)); };
  const sq = $("#scopeQ").value.trim(), terms = [...words(sq), ...words($("#caseQ").value)];
  if (terms.length) {
    const pool = base.length ? base : D.cases.filter(caseFits);
    matched = pool.filter((c) => has(c, terms));
    if (!base.length) matched.sort((a, b) => (a.판정 === "참고") - (b.판정 === "참고") || (b.출처구분 === "참고자료") - (a.출처구분 === "참고자료"));
  }
  const cnt = cntOf(matched), baseCnt = cntOf(base);
  $("#tabCases").textContent = `사례 ${matched.length}`;
  $("#dist").innerHTML = ["인정", "불인정", "판단필요", "참고"].map((k) =>
    `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${tag(k)}<b>${cnt[k]}</b></button>`).join("");
  if (v) {
    $("#casesHint").innerHTML = base.length
      ? `<span class="pill">비슷한 사례 <b>${base.length}</b></span>${["인정", "불인정", "판단필요", "참고"].map((k) => `<span class="pill" data-v="${k}">${k} <b>${baseCnt[k]}</b></span>`).join("")}${v === "인정" && baseCnt.불인정 ? `<span class="warn-note">불인정 사례가 있어요. 조건을 한 번 더 확인하세요.</span>` : ""}`
      : `<span class="pill">비슷한 사례를 찾지 못했어요</span>`;
  }
  renderScope(sq, sq ? (base.length ? base : D.cases.filter(caseFits)).filter((c) => has(c, words(sq))) : []);
  page = 0; drawCards();
}

// 낱말별 2글자 조합(한글·영문만, 숫자·기호 제외)과 숫자 토큰
const wordGrams = (t) => { const g = new Set(); t.replace(/[^가-힣a-zA-Z\s]/g, " ").split(/\s+/).forEach((w) => grams(w).forEach((x) => g.add(x))); return g; };
const nums = (t) => t.match(/\d+(?:[.,]\d+)*%?/g) || [];
let autoQ = null; // 상세 내용 때문에 자동으로 체크한 질문

// 검색어(상세 범위) 적정 여부: ① 고른 항목의 체크 질문에 걸리면 그 규정 판정 ② 아니면 검색된 사례의 판정 분포(검수·공식 사례 2배 가중)
function scopeVerdict(q, list) {
  let rh = null;
  if (rule) {
    const f = fields(), qg = wordGrams(q), qn = nums(q);
    // 질문 본문만 비교(괄호 속 보충 설명은 반대 뜻이 섞여 오판정 위험), "없이·아닌" 같은 부정형 질문은 제외
    // 글자(한글·영문) 조합이 있어야 하고, 숫자는 통째로 같아야 함("0%"가 "70%"에 걸리지 않게)
    const qs = !qg.size ? [] : rule.questions.filter((x) => {
      const lab = x.label.replace(/\(.*?\)/g, "");
      if (/없이|아닌|않|없는/.test(lab)) return false;
      const ln = nums(lab);
      if (qn.some((v) => !ln.includes(v))) return false;
      const lg = wordGrams(lab); let n = 0; qg.forEach((g) => lg.has(g) && n++);
      return n >= Math.max(1, Math.ceil(qg.size * 0.6));
    });
    const hs = qs.flatMap((x) => rule.checks.filter((c) => c.when.some(([k]) => k === x.id) && hit(c.when, { ...f, [x.id]: true })).map((c) => ({ ...c, qid: x.id })));
    if (hs.length) rh = hs.reduce((m, c) => (RANK[c.판정] > RANK[m.판정] ? c : m));
  }
  const w = { 인정: 0, 불인정: 0, 판단필요: 0 };
  list.forEach((c) => c.판정 in w && (w[c.판정] += c.자동 ? 1 : 2));
  const W = w.인정 + w.불인정 + w.판단필요;
  // 검수되지 않은 자동분류 사례뿐이면 단정하지 않음
  const sure = list.some((c) => !c.자동 && c.판정 !== "참고");
  let cv = !W ? null : !sure ? "판단필요" : w.불인정 / W >= 0.5 ? "불인정" : w.인정 / W >= 0.6 && !w.불인정 ? "인정" : "판단필요";
  // 항목을 고른 상태에서 규정에 직접 걸리지 않으면, 사례의 불인정은 다른 조건(참석자 구성 등) 때문일 수 있어 단정하지 않음
  const soft = rule && cv === "불인정";
  if (soft) cv = "판단필요";
  return { rh, cv, w, W, sure, soft };
}

function renderScope(q, list) {
  const box = $("#scope");
  const { rh, cv, w, W, sure, soft } = q ? scopeVerdict(q, list) : {};
  // 상세 내용이 체크 질문에 해당하면 그 질문도 체크해 가운데 판정과 맞춤
  // 상세 내용이 바뀌어 더는 해당하지 않으면 자동으로 켠 체크는 다시 끔
  if (autoQ && autoQ !== rh?.qid) { const old = $(`[data-q="${autoQ}"]`); autoQ = null; if (old?.checked) { old.checked = false; setTimeout(run); } }
  const cb = rh && $(`[data-q="${rh.qid}"]`);
  if (cb && !cb.checked) { cb.checked = true; autoQ = rh.qid; setTimeout(run); }
  if (!q) { box.hidden = true; return; }
  const v = rh ? rh.판정 : cv;
  const n = list.filter((c) => c.판정 !== "참고").length;
  const dist = W ? `사례 ${n}건: 인정 ${list.filter((c) => c.판정 === "인정").length} · 불인정 ${list.filter((c) => c.판정 === "불인정").length} · 판단필요 ${list.filter((c) => c.판정 === "판단필요").length}` : "판정이 담긴 사례 없음";
  const why = rh ? `규정: ${rh.사유}` : cv ? `${dist} 기준 추정${sure ? "" : "(검수 안 된 자동분류 사례뿐이라 확정하지 않음)"}${soft ? ". 불인정 사례가 많으니 사례의 조건을 확인하세요" : ""}` : "규정·사례로 판단할 근거가 부족해요. 연구지원팀에 문의하세요.";
  const conflict = rh && rh.판정 !== "불인정" && w.불인정 ? ` (사례 중 불인정 있음)` : "";
  box.hidden = false; box.dataset.v = v || "참고";
  box.innerHTML = `${v ? tag(v) : tag("참고")}<span class="txt"><b>${esc(v ? lab(v) : "판단 근거 부족")}</b> ${esc(why + conflict)}</span><button type="button" id="scopeMore">근거</button>`;
  $("#scopeMore").onclick = () => openDlg(`<h3>‘${esc(q)}’ 적정 여부${rule ? ` · ${esc(rule.항목)}` : ""}</h3>
    <p>${v ? tag(v) : tag("참고")} <b>${esc(v ? lab(v) : "판단 근거 부족")}</b></p>
    ${rh ? `<p>${esc(rh.사유)}<br><small>${rh.근거.map(cite).map(esc).join(" / ")}</small></p>` : ""}
    <p>${esc(dist)}${W ? ` (검수·공식 사례는 2배, 자동분류는 1배로 계산)` : ""}${conflict}</p>
    <p class="why">${rh ? "고른 항목의 규정에 직접 해당하는 내용으로 판정했습니다." : "규정에 직접 해당하는 내용이 없어 검색된 사례 판정 분포로 추정했습니다. 오른쪽 사례 원문을 꼭 확인하세요."}${rule ? "" : " 왼쪽에서 집행 항목을 먼저 고르면 규정 기준으로도 판단합니다."}</p>`);
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
      <span class="line">${tag(c.판정)}<span class="src-tag">${esc(c.출처구분 === "참고자료" ? c.출처.replace(/\(.*\)/, "") : c.출처구분)}</span>${c.자동 ? `<span class="src-tag auto" title="키워드로 자동 분류된 게시판 글입니다. 원문 답변을 꼭 확인하세요.">자동분류</span>` : ""}<span class="w">${[c.원문URL ? "" : where(c.출처, c.쪽), c.일자 || ""].filter(Boolean).join(" · ")}</span></span>
      <span class="t" title="${esc(c.제목)}">${esc(c.제목)}</span><span class="w">${esc(c.비목)} · ${esc(c.판정근거)}</span></button></li>`).join("")
    : `<li class="nothing">${$("#caseQ").value.trim() ? "검색어에 맞는 사례가 없어요. 다른 말로 찾아보세요." : rule ? "조건에 맞는 사례가 없습니다." : "항목을 고르거나 위 검색창에 찾을 말을 입력하세요."}</li>`;
  $("#pageInfo").textContent = `${list.length ? page + 1 : 0} / ${list.length ? pages : 0}`;
  $("#prev").disabled = page === 0; $("#next").disabled = page >= pages - 1;
}

// 글 시점: 게시판은 작성일·답변일, 참고자료는 발간 시점
const when = (c) => c.일자 ? ` · ${c.원문URL ? `작성 ${c.일자}${c.답변일 ? ` · 답변 ${c.답변일}` : ""}` : esc(c.일자)}` : (c.원문URL ? " · 작성일 미표기" : "");

function showCase(c) {
  openDlg(`<p>${tag(c.판정)} <span class="src-tag">${esc(c.출처)}</span> <span class="w">${c.원문URL ? `<a href="${esc(c.원문URL)}" target="_blank" rel="noopener">원문 보기</a>` : `${where(c.출처, c.쪽)} · ${esc(c.유형)}`}${when(c)}</span></p>
    <h3>${esc(c.제목)}</h3><div class="body">${esc(c.답변)}</div>
    <p class="why">${c.자동 ? `자동 분류(키워드 “${esc(c.판정근거)}” 기준)입니다. 원문 답변으로 판단하세요.` : `${esc(c.판정근거.replace(/^검수: /, "판정 이유: "))}`}<br>판정이 원문과 다르면 연구지원팀에 알려 주세요.</p>`);
}

// 조건의 과제 구분(track)·부처(ministry) 부분만 보고 지금 선택한 부처에 해당하는지
const trackOk = (when, m) => when.every(([k, op, v]) => (k !== "track" || OPS[op](trackOf(m), v)) && (k !== "ministry" || OPS[op](m, v)));
function renderAgreeTab(ag) {
  const all = rule.agree.filter((a) => trackOk(a.when, $("#track").value));
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
// 부처 소관 운영규정 중 판정 규칙에 반영한 특례(나머지는 혁신법·사용기준을 그대로 따름)
const MIN_NOTE = {
  중소벤처기업부: ["중소기업기술개발 지원사업 운영요령", "위탁연구개발비는 조금이라도 늘리면 승인 대상(통보 불가)입니다."],
  기후에너지환경부: ["에너지기술개발사업 공통 운영요령(KETEP) · 환경기술개발사업 운영규정(KEITI)", "에너지 사업은 참여연구자 인건비계상률 10% 이상(학생 제외), 환경 사업은 연구기간 연장 1회 6개월·2회 한도와 평가단 심의가 추가됩니다."],
  보건복지부: ["보건의료기술 연구개발사업 운영·관리규정", "간접비고시비율 상향에 따른 간접비비율 조정은 보건복지부장관 사전 승인 대상입니다."],
  과학기술정보통신부: ["과학기술분야 연구개발사업 처리규정", "집단연구지원사업은 간접비 총액의 50% 이상을 연구책임자 발의로 집행해야 합니다."],
  국토교통부: ["국토교통부소관 연구개발사업 운영규정", "협약변경·연구개발비는 혁신법 기준과 같으며 별도 특례가 없습니다."],
};
function regLine(m) {
  if (m === "__private") return "지원기관 협약서 + POSTECH 연구비관리지침";
  if (m === "__internal") return "POSTECH 연구개발과제 운영지침";
  if (trackOf(m) === "motie") return `${m} · 산업기술혁신사업 공통 운영요령 우선 + 혁신법 공통`;
  return MIN_NOTE[m] ? `${m} · ${MIN_NOTE[m][0]} + 혁신법 공통` : `${m} · 혁신법 공통 기준`;
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
      MIN_NOTE[m] ? `판정은 혁신법 공통 기준에 ${MIN_NOTE[m][0]}의 특례를 더해 합니다. ${MIN_NOTE[m][1]}` :
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
  $("#pCases").hidden = name !== "cases"; $("#pRegs").hidden = name !== "regs"; $("#pAgree").hidden = name !== "agree"; $("#pLaw").hidden = name !== "law"; $("#pSearch").hidden = name !== "search";
  if (name === "cases") drawCards();
  if (name === "search") { if (!SX) runSearch(); else drawSearch(); $("#sQ").focus(); }
}

// 검색 탭: 고른 항목·부처와 상관없이 사례 전체와 규정(내규·운영요령 조항 + 판정 규칙의 근거 발췌)을 한꺼번에 찾음
let SX = null, sHits = [], sFilter = "all", sPage = 0;
function searchIndex() {
  const regs = new Map();
  D.cases.filter((c) => c.유형 === "규정조항").forEach((c) => regs.set(c.id, { k: "reg", id: c.id, 문서: c.출처, 제목: c.제목, 본문: c.답변, 위치: where(c.출처, c.쪽), 일자: c.일자 || "", items: [] }));
  // 판정 규칙의 근거(혁신법 매뉴얼·사용기준·부처 규정 등): 같은 문서·조항은 하나로 묶고 이 근거로 판정하는 항목을 함께 보여 줌
  D.rules.forEach((r) => [r.base, ...r.checks, ...r.agree].forEach((x) => x.근거.forEach((g) => {
    if (!g.발췌) return;
    const key = g.문서 + "|" + g.조항;
    if (!regs.has(key)) regs.set(key, { k: "reg", id: key, 문서: g.문서, 제목: g.조항, 본문: g.발췌, 위치: g.출처 === "법제처" ? "법제처 현행" : where(g.문서, g.쪽), 일자: "", items: [] });
    const e = regs.get(key); if (!e.items.includes(r)) e.items.push(r);
  })));
  const cases = D.cases.filter((c) => c.유형 !== "규정조항").map((c) => ({ k: "case", id: c.id, c, 제목: c.제목, 본문: c.답변 + " " + c.비목 + " " + c.출처 }));
  return [...regs.values(), ...cases].map((x) => ({ ...x, lt: x.제목.toLowerCase(), lb: (x.문서 || "").toLowerCase() + " " + x.본문.toLowerCase() }));
}
function runSearch() {
  SX ||= searchIndex();
  const q = $("#sQ").value.trim().toLowerCase(), ws = q.split(/\s+/).filter(Boolean);
  if (!ws.length) sHits = [];
  else {
    const cnt = (t, w) => t.split(w).length - 1;
    let hits = SX.filter((x) => ws.every((w) => x.lt.includes(w) || x.lb.includes(w)));
    // 낱말이 모두 들어간 결과가 없으면 2글자 조합 기준으로 넓혀 찾음(띄어쓰기·조사 차이)
    if (!hits.length) { const g = grams(q); hits = SX.filter((x) => { let n = 0; g.forEach((y) => (x.lt.includes(y) || x.lb.includes(y)) && n++); return g.size && n >= Math.ceil(g.size * 0.7); }); }
    const score = (x) => ws.reduce((a, w) => a + cnt(x.lt, w) * 3 + Math.min(cnt(x.lb, w), 3), 0);
    const rank = (x) => (x.k === "reg" ? 0 : x.c.판정 === "참고" ? 2 : 1);
    sHits = hits.map((x) => [score(x), x]).sort((a, b) => b[0] - a[0] || rank(a[1]) - rank(b[1]) || (b[1].c?.일자 || "").localeCompare(a[1].c?.일자 || "")).map(([, x]) => x);
  }
  const nReg = sHits.filter((x) => x.k === "reg").length;
  $("#tabSearch").textContent = sHits.length ? `검색 ${sHits.length}` : "검색";
  $("#sDist").innerHTML = [["all", "전체", sHits.length], ["case", "사례", sHits.length - nReg], ["reg", "규정", nReg]].map(([k, t, n]) =>
    `<button type="button" data-s="${k}" aria-pressed="${sFilter === k}"><span>${t}</span><b>${n}</b></button>`).join("");
  sPage = 0; drawSearch();
}
const mark = (s, ws) => ws.reduce((h, w) => h.split(esc(w)).join(`<mark>${esc(w)}</mark>`), esc(s));
function drawSearch() {
  const ws = $("#sQ").value.trim().split(/\s+/).filter(Boolean);
  const list = sFilter === "all" ? sHits : sHits.filter((x) => x.k === sFilter);
  const box = $("#sCards");
  // 화면 높이에 맞춰 한 쪽 결과 수 계산 (스크롤 없이)
  box.innerHTML = list.length ? `<li><button class="probe"><span class="line">${tag("인정")}</span><span class="t">가<br>가<br>가</span><span class="w">가</span></button></li>` : "";
  const h = box.firstElementChild?.offsetHeight || 88, per = Math.max(2, Math.floor((box.clientHeight + 7) / (h + 7)));
  const pages = Math.max(1, Math.ceil(list.length / per)); sPage = Math.min(sPage, pages - 1);
  box.innerHTML = list.length ? list.slice(sPage * per, sPage * per + per).map((x) => x.k === "reg"
    ? `<li><button type="button" data-sid="${esc(x.id)}"><span class="line"><span class="src-tag reg">규정</span><span class="src-tag">${esc(x.문서.replace(/\(.*\)/, ""))}</span><span class="w">${esc(x.위치)}${x.일자 ? ` · ${esc(x.일자)}` : ""}</span></span>
        <span class="t">${mark(x.제목, ws)}</span><span class="w">${esc(x.본문.slice(0, 90))}${x.items.length ? ` · 관련 항목 ${x.items.length}` : ""}</span></button></li>`
    : `<li><button type="button" data-sid="${esc(x.id)}"><span class="line">${tag(x.c.판정)}<span class="src-tag">${esc(x.c.출처구분 === "참고자료" ? x.c.출처.replace(/\(.*\)/, "") : x.c.출처구분)}</span><span class="w">${[x.c.원문URL ? "" : where(x.c.출처, x.c.쪽), x.c.일자 || ""].filter(Boolean).join(" · ")}</span></span>
        <span class="t">${mark(x.제목, ws)}</span><span class="w">${esc(x.c.비목)} · ${esc(x.c.판정근거.replace(/^검수: /, ""))}</span></button></li>`).join("")
    : `<li class="nothing">${ws.length ? "찾는 말이 들어간 사례·규정이 없어요. 다른 말로 찾아보세요." : "찾을 말을 입력하면 모든 사례와 규정에서 한 번에 찾아 드려요.<br><small>고른 집행 항목·부처와 상관없이 전체에서 찾습니다.</small>"}</li>`;
  $("#sPage").textContent = `${list.length ? sPage + 1 : 0} / ${list.length ? pages : 0}`;
  $("#sPrev").disabled = sPage === 0; $("#sNext").disabled = sPage >= pages - 1;
}
function showReg(x) {
  openDlg(`<p><span class="src-tag reg">규정</span> <span class="src-tag">${esc(x.문서)}</span> <span class="w">${esc(x.위치)}</span></p>
    <h3>${esc(x.제목)}</h3><div class="body">${esc(x.본문)}</div>
    ${x.items.length ? `<p class="why">이 규정으로 판정하는 항목 (누르면 바로 점검)</p><div class="rel-items">${x.items.map((r) => `<button type="button" data-rule="${r.id}">${esc(r.항목)}</button>`).join("")}</div>` : /^POSTECH/.test(x.문서) ? `<p class="why">POSTECH 내규는 조항 요지만 싣습니다. 전문은 POSTECH 규정집을 확인하세요.</p>` : ""}`);
}

// 이벤트
$("#form").addEventListener("input", (e) => {
  if (e.target.classList.contains("date")) maskDate(e.target);
  if (e.target.id === "amount") { // 숫자만 남기고 천 단위 콤마
    const d = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    e.target.value = d ? Number(d).toLocaleString("ko-KR") : "";
  }
  if (e.target.id === "scopeQ") filter = null;
  run();
});
$("#track").addEventListener("change", () => { renderQs(); renderRegs(); if (!rule) renderCases(null); });
document.querySelectorAll('[name="mode"]').forEach((x) => x.addEventListener("change", () => { fillItems(); setRule(null); history.replaceState(null, "", location.pathname + location.search); }));
$("#itemSel").addEventListener("change", () => { setRule(D.rules.find((r) => r.id === $("#itemSel").value) || null); });
// 달력 버튼: 숨은 date 입력의 기본 달력을 열고, 고른 날짜를 글자 칸에 넣음
$("#form").addEventListener("click", (e) => {
  const b = e.target.closest(".cal"); if (!b) return;
  const text = b.previousElementSibling, pick = b.nextElementSibling;
  pick.value = dateOf("#" + text.id) ? text.value : "";
  pick.onchange = () => { text.value = pick.value; maskDate(text); run(); };
  try { pick.showPicker(); } catch { text.focus(); }
});
$("#form").addEventListener("submit", (e) => e.preventDefault());
$("#quick").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") setRule(findRule(e.target.textContent)); });
$("#caseQ").addEventListener("input", () => { filter = null; renderCases(); });
$("#sQ").addEventListener("input", () => { clearTimeout(runSearch.t); runSearch.t = setTimeout(runSearch, 150); });
$("#sDist").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; sFilter = b.dataset.s; runSearch(); });
$("#sCards").addEventListener("click", (e) => { const b = e.target.closest("[data-sid]"); if (!b) return; const x = SX.find((y) => y.id === b.dataset.sid); x.k === "reg" ? showReg(x) : showCase(x.c); });
$("#sPrev").onclick = () => { sPage--; drawSearch(); };
$("#sNext").onclick = () => { sPage++; drawSearch(); };
// 규정 창의 관련 항목 단추: 창을 닫고 그 항목으로 점검
$("#dlgBody").addEventListener("click", (e) => { const b = e.target.closest("[data-rule]"); if (!b) return; $("#dlg").close(); setRule(D.rules.find((r) => r.id === b.dataset.rule)); });
$("#dist").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = filter === b.dataset.f ? null : b.dataset.f; renderCases(); });
$("#cards").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) showCase(D.cases.find((c) => c.id === b.dataset.id)); });
$("#prev").onclick = () => { page--; drawCards(); };
$("#next").onclick = () => { page++; drawCards(); };
document.querySelector(".tabs").addEventListener("click", (e) => e.target.dataset.tab && tab(e.target.dataset.tab));
addEventListener("resize", () => drawCards());

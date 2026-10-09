// 연구비 집행 점검: 규칙 판정·사례 검색 모두 브라우저에서 처리 (서버·LLM 호출 없음)
const $ = (s) => document.querySelector(s);
const RANK = { 인정: 0, 판단필요: 1, 불인정: 2 };
const LABEL = { 인정: "적정", 판단필요: "확인 필요", 불인정: "부적정" };
const SEAL = { 인정: "적정", 판단필요: "확인<br>필요", 불인정: "부적정" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tag = (v) => `<span class="tag" data-v="${v}">${v}</span>`;
const grams = (s) => { s = s.replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const cite = (g) => `${g.문서} ${g.조항} (PDF ${g.쪽}쪽)`;

let D, rule = null, filter = null, page = 0, matched = [], lastV = null;

fetch("data.json").then((r) => r.json()).then((d) => {
  D = d;
  D.cases.forEach((c) => (c.g = grams(c.제목 + " " + c.답변.slice(0, 160))));
  D.rules.forEach((r) => (r.g = grams(r.항목 + " " + r.keywords.join(" "))));
  $("#meta").textContent = `규정 기준일 ${D.meta.기준일} · 규정 ${D.meta.문서.length}종 · 사례 ${D.meta.사례수.toLocaleString()}건`;
  $("#track").innerHTML = D.tracks.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
  $("#items").innerHTML = D.rules.map((r) => `<option value="${esc(r.항목)}">${esc(r.비목)}</option>`).join("");
  $("#quick").innerHTML = ["회의비(식비 포함)", "국외 출장비", "컴퓨터·프린터 등 범용 사무기기", "연구장비 구입·임차", "학생인건비 지급", "전문가 활용비(자문료·강사료·원고료)"]
    .map((n) => `<li><button type="button">${n}</button></li>`).join("");
  $("#spend").valueAsDate = new Date();
  fromHash();
});
function fromHash() {
  const r = D.rules.find((r) => r.id === decodeURIComponent(location.hash.slice(1)));
  if (r && r !== rule) { $("#item").value = r.항목; pick(); }
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

function pick() {
  const r = findRule($("#item").value);
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
  const n = (id) => ($(id).value === "" ? null : Number($(id).value));
  const f = { track: $("#track").value, amount: n("#amount"), people: n("#people") };
  f.perPerson = f.amount != null && f.people ? f.amount / f.people : null;
  const s = $("#spend").valueAsDate, e = $("#end").valueAsDate;
  f.daysToEnd = s && e ? Math.round((e - s) / 864e5) : null;
  rule?.questions.forEach((q) => (f[q.id] = !!$(`[data-q="${q.id}"]`)?.checked));
  return f;
}

const OPS = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b };
const hit = (when, f) => when.every(([k, op, v]) => f[k] !== null && f[k] !== undefined && OPS[op](f[k], v));

// 협약변경: 필요한 변경과 사용자가 입력한 상태를 대조
function agreement(f) {
  const need = rule.agree.filter((a) => hit(a.when, f));
  const done = document.querySelector('[name="ag"]:checked').value === "done";
  const agDate = $("#agDate").valueAsDate, spend = $("#spend").valueAsDate;
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
  $("#what").textContent = `${rule.비목} · ${D.tracks.find((t) => t.id === f.track).label}`;
  $("#vTitle").textContent = `${rule.항목}: ${LABEL[v]}`;

  const items = [
    ...hits.sort((a, b) => RANK[b.판정] - RANK[a.판정]).map((h) => ({ v: h.판정, t: h.사유, g: h.근거 })),
    ...ag.filter((a) => a.v !== "인정").map((a) => ({ v: a.v, t: `협약변경(${a.유형}): ${a.내용}. ${a.msg}.`, g: a.근거 })),
  ];
  if (!items.length) items.push({ v: "인정", t: rule.base.사유, g: rule.base.근거 });
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
  const q = $("#item").value.trim();
  if (!D) return;
  const g = grams(q + " " + (rule ? rule.keywords.join(" ") : ""));
  // 참고자료(공식 문서) 우선, 그 안에서 관련도 순
  matched = q ? D.cases.map((c) => {
    let s = 0; g.forEach((x) => c.g.has(x) && s++);
    if (rule && c.비목 === rule.비목) s += 4;
    return [s, c];
  }).filter(([s]) => s >= 6).sort((a, b) => (b[1].출처구분 === "참고자료") - (a[1].출처구분 === "참고자료") || b[0] - a[0]).map(([, c]) => c) : [];
  const cnt = { 인정: 0, 불인정: 0, 판단필요: 0 };
  matched.forEach((c) => cnt[c.판정]++);
  $("#tabCases").textContent = `사례 ${matched.length}`;
  $("#dist").innerHTML = ["인정", "불인정", "판단필요"].map((k) =>
    `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${tag(k)}<b>${cnt[k]}</b></button>`).join("");
  if (v) {
    $("#casesHint").innerHTML = matched.length
      ? `유사 사례 ${matched.length}건 중 인정 ${cnt.인정} · <b class="${cnt.불인정 ? "bad" : ""}">불인정 ${cnt.불인정}</b> · 판단필요 ${cnt.판단필요}${v === "인정" && cnt.불인정 ? ". 불인정 사례가 있으니 조건을 다시 확인하세요." : ""}`
      : "유사 사례를 찾지 못했습니다.";
  }
  page = 0; drawCards();
}

function drawCards() {
  const list = filter ? matched.filter((c) => c.판정 === filter) : matched;
  const box = $("#cards");
  // 화면 높이에 맞춰 한 쪽 카드 수 계산 (스크롤 없이)
  box.innerHTML = list.length ? `<li><button class="probe"><span class="line">${tag("인정")}</span><span class="t">가<br>가</span><span class="w">가</span></button></li>` : "";
  const h = box.firstElementChild?.offsetHeight || 88;
  const per = Math.max(2, Math.floor((box.clientHeight + 7) / (h + 7)));
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages - 1);
  box.innerHTML = list.length ? list.slice(page * per, page * per + per).map((c) => `<li><button type="button" data-id="${c.id}">
      <span class="line">${tag(c.판정)}<span class="src-tag">${esc(c.출처구분 === "참고자료" ? c.출처.replace(/\(.*\)/, "") : c.출처구분)}</span><span class="w">${c.원문URL ? "" : `PDF ${c.쪽}쪽`}</span></span>
      <span class="t">${esc(c.제목)}</span><span class="w">${esc(c.비목)} · ${esc(c.판정근거)}</span></button></li>`).join("")
    : `<li class="nothing">${$("#item").value.trim() ? "조건에 맞는 사례가 없습니다." : "항목을 입력하면 참고자료·게시판의 관련 사례가 나옵니다."}</li>`;
  $("#pageInfo").textContent = `${list.length ? page + 1 : 0} / ${list.length ? pages : 0}`;
  $("#prev").disabled = page === 0; $("#next").disabled = page >= pages - 1;
}

function showCase(c) {
  openDlg(`<p>${tag(c.판정)} <span class="src-tag">${esc(c.출처)}</span> <span class="w">${c.원문URL ? `<a href="${esc(c.원문URL)}" target="_blank" rel="noopener">원문 보기</a>` : `PDF ${c.쪽}쪽 · ${esc(c.유형)}`}</span></p>
    <h3>${esc(c.제목)}</h3><div class="body">${esc(c.답변)}</div>
    <p class="why">판정 근거 표현: “${esc(c.판정근거)}” (키워드 기준 자동 분류. 원문과 다르면 연구지원팀에 알려 주세요.)</p>`);
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
  $("#pCases").hidden = name !== "cases"; $("#pAgree").hidden = name !== "agree"; $("#pLaw").hidden = name !== "law";
  if (name === "cases") drawCards();
}

// 이벤트
$("#form").addEventListener("input", (e) => (e.target.id === "item" ? pick() : run()));
$("#form").addEventListener("submit", (e) => e.preventDefault());
$("#quick").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") { $("#item").value = e.target.textContent; pick(); } });
$("#dist").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = filter === b.dataset.f ? null : b.dataset.f; renderCases(); });
$("#cards").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) showCase(D.cases.find((c) => c.id === b.dataset.id)); });
$("#prev").onclick = () => { page--; drawCards(); };
$("#next").onclick = () => { page++; drawCards(); };
document.querySelector(".tabs").addEventListener("click", (e) => e.target.dataset.tab && tab(e.target.dataset.tab));
addEventListener("resize", () => drawCards());

// 사례 백과: 사례만 모아 판정·출처·비목·부처로 거르고 찾아보는 페이지 (서버·LLM 호출 없음)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tag = (v) => `<span class="tag" data-v="${v}">${v}</span>`;
const grams = (s) => { s = s.replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const where = (doc, p) => (/산업기술혁신|운영요령/.test(doc) && !/POSTECH/.test(doc) ? `HWP 원문 ${p}구간` : `PDF ${p}쪽`);
const VS = ["인정", "불인정", "판단필요", "참고"];
const SRC = ["참고자료", "NRF", "IRIS", "전문기관"];
const SRC_NAME = { 참고자료: "사례집·매뉴얼", NRF: "한국연구재단", IRIS: "IRIS", 전문기관: "전문기관" };
const VDESC = { 인정: "집행할 수 있다고 본 사례", 불인정: "집행할 수 없거나 환수·제재된 사례", 판단필요: "조건·사실관계에 따라 달라지는 사례", 참고: "제도·절차 안내" };

let C = [], st = { q: "", v: new Set(), s: new Set(), b: "", m: "", sort: "rel" }, hits = [], shown = 0, cur = null;

fetch("data.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
  C = d.cases.filter((c) => c.유형 !== "규정조항"); // 내규 조항은 빼고 사례만
  C.forEach((c) => { c.lt = c.제목.toLowerCase(); c.lb = (c.답변 + " " + c.비목 + " " + c.출처).toLowerCase(); c.g = grams(c.제목 + " " + c.답변.slice(0, 160)); });
  $("#meta").textContent = `사례 ${C.length.toLocaleString()}건 · 갱신 ${d.meta.기준일}`;
  const ms = [...new Set(C.flatMap((c) => c.부처).filter((m) => m !== "공통"))].sort();
  $("#min").insertAdjacentHTML("beforeend", ms.map((m) => `<option>${esc(m)}</option>`).join(""));
  fromHash();
  apply();
  addEventListener("hashchange", fromHash);
});

// 주소의 #c=사례ID 로 바로 열기(링크 공유)
function fromHash() {
  const id = decodeURIComponent((location.hash.match(/c=([^&]+)/) || [])[1] || "");
  const c = id && C.find((x) => x.id === id);
  if (c && c !== cur) open(c, false);
}

const terms = () => st.q.toLowerCase().split(/\s+/).filter(Boolean);
// 판정·출처 외 조건으로 거른 결과(칩 숫자는 자기 조건을 뺀 나머지 조건 기준으로 셈)
function base(skip) {
  const ws = terms();
  let r = C.filter((c) => (!st.m || c.부처.includes(st.m) || c.부처.includes("공통")) && (skip === "b" || !st.b || c.비목 === st.b)
    && (skip === "v" || !st.v.size || st.v.has(c.판정)) && (skip === "s" || !st.s.size || st.s.has(c.출처구분)));
  if (ws.length) {
    const and = r.filter((c) => ws.every((w) => c.lt.includes(w) || c.lb.includes(w)));
    // 낱말이 모두 들어간 사례가 없으면 2글자 조합으로 넓혀 찾음(띄어쓰기·조사 차이)
    if (and.length) r = and;
    else { const g = grams(st.q.toLowerCase()); r = r.filter((c) => { let n = 0; g.forEach((y) => (c.lt.includes(y) || c.lb.includes(y)) && n++); return g.size && n >= Math.ceil(g.size * 0.7); }); }
  }
  return r;
}
const count = (list, key) => list.reduce((m, c) => ((m[c[key]] = (m[c[key]] || 0) + 1), m), {});

function apply() {
  const ws = terms(), n = (t, w) => t.split(w).length - 1;
  hits = base();
  const official = (c) => (c.출처구분 === "참고자료" ? 0 : 1), rk = (c) => (c.판정 === "참고" ? 1 : 0);
  if (st.sort === "new") hits.sort((a, b) => (b.일자 || "").localeCompare(a.일자 || ""));
  else if (st.sort === "old") hits.sort((a, b) => (a.일자 || "9").localeCompare(b.일자 || "9"));
  else {
    const sc = (c) => ws.reduce((a, w) => a + n(c.lt, w) * 3 + Math.min(n(c.lb, w), 3), 0);
    hits = hits.map((c) => [sc(c), c]).sort((a, b) => b[0] - a[0] || rk(a[1]) - rk(b[1]) || official(a[1]) - official(b[1]) || (b[1].일자 || "").localeCompare(a[1].일자 || "")).map(([, c]) => c);
  }
  // 칩·목차 숫자
  const vc = count(base("v"), "판정"), sc = count(base("s"), "출처구분"), bc = count(base("b"), "비목");
  $("#vChips").innerHTML = VS.map((v) => `<button type="button" data-v="${v}" aria-pressed="${st.v.has(v)}" title="${VDESC[v]}">${tag(v)}<b>${(vc[v] || 0).toLocaleString()}</b></button>`).join("");
  $("#sChips").innerHTML = SRC.map((s) => `<button type="button" data-s="${s}" aria-pressed="${st.s.has(s)}">${SRC_NAME[s]} <b>${(sc[s] || 0).toLocaleString()}</b></button>`).join("");
  const bs = Object.entries(bc).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  $("#toc").innerHTML = `<li><button type="button" data-b="" aria-current="${!st.b}">전체 <b>${bs.reduce((a, [, k]) => a + k, 0).toLocaleString()}</b></button></li>` +
    bs.map(([b, k]) => `<li><button type="button" data-b="${esc(b)}" aria-current="${st.b === b}">${esc(b)} <b>${k.toLocaleString()}</b></button></li>`).join("");
  $("#listTitle").textContent = [st.b || "전체 사례", st.v.size ? [...st.v].join("·") : ""].filter(Boolean).join(" · ");
  $("#count").textContent = `${hits.length.toLocaleString()}건`;
  shown = 0; $("#list").innerHTML = ""; more();
  $("#list").scrollTop = 0;
}

const mark = (s, ws) => ws.reduce((h, w) => h.split(esc(w)).join(`<mark>${esc(w)}</mark>`), esc(s));
const srcLabel = (c) => (c.출처구분 === "참고자료" ? c.출처.replace(/\(.*\)/, "") : c.출처구분 === "IRIS" || c.출처구분 === "NRF" ? c.출처 : c.출처);
const whenLine = (c) => [c.원문URL ? "" : where(c.출처, c.쪽), c.일자 || ""].filter(Boolean).join(" · ");

// 목록은 60건씩 이어 붙임(끝에 닿으면 더 불러옴)
function more() {
  const ws = terms(), ul = $("#list"), next = hits.slice(shown, shown + 60);
  ul.querySelector(".more")?.remove();
  if (!hits.length) { ul.innerHTML = `<li class="nothing">조건에 맞는 사례가 없어요.<br><small>찾을 말을 바꾸거나 조건을 지워 보세요.</small></li>`; return; }
  ul.insertAdjacentHTML("beforeend", next.map((c) => `<li><button type="button" data-id="${esc(c.id)}" aria-current="${cur === c}">
    <span class="line">${tag(c.판정)}<span class="src-tag">${esc(srcLabel(c))}</span><span class="w">${esc(whenLine(c))}</span></span>
    <span class="t">${mark(c.제목, ws)}</span>
    <span class="w">${esc(c.비목)} · ${esc(c.판정근거.replace(/^검수: /, ""))}</span></button></li>`).join(""));
  shown += next.length;
  if (shown < hits.length) { ul.insertAdjacentHTML("beforeend", `<li class="more"><button type="button" id="moreBtn">${(hits.length - shown).toLocaleString()}건 더 보기</button></li>`); io.observe($("#moreBtn")); }
}
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (io.unobserve(e.target), more())), { root: $("#list"), rootMargin: "200px" });

function open(c, push = true) {
  cur = c;
  document.querySelectorAll("#list [data-id]").forEach((b) => b.setAttribute("aria-current", b.dataset.id === c.id));
  const ws = terms();
  // 관련 사례: 같은 비목에서 글자 조합이 많이 겹치는 순
  const rel = C.filter((x) => x !== c && x.비목 === c.비목).map((x) => { let s = 0; c.g.forEach((y) => x.g.has(y) && s++); return [s, x]; })
    .sort((a, b) => b[0] - a[0]).slice(0, 5).filter(([s]) => s > 3).map(([, x]) => x);
  const why = c.판정근거.replace(/^검수: /, "");
  $("#doc").innerHTML = `<div class="dhead">${tag(c.판정)}<span class="src-tag">${esc(c.출처)}</span><span class="src-tag">${esc(c.비목)}</span></div>
    <h2 class="dtitle">${mark(c.제목, ws)}</h2>
    <p class="dmeta">${c.원문URL ? `<a href="${esc(c.원문URL)}" target="_blank" rel="noopener">원문 보기 ↗</a>` : esc(where(c.출처, c.쪽)) + " · " + esc(c.유형)}${c.일자 ? ` · ${c.원문URL ? "작성 " : ""}${esc(c.일자)}` : ""}${c.답변일 ? ` · 답변 ${esc(c.답변일)}` : ""} · 적용: ${esc(c.부처.join(", "))}</p>
    <section class="dwhy" data-v="${c.판정}"><b>${c.판정 === "참고" ? "참고 사례" : `${c.판정} 판정 이유`}</b><p>${esc(why)}</p></section>
    <div class="dbody">${mark(c.답변, ws)}</div>
    ${rel.length ? `<h3 class="drel">같은 비목의 비슷한 사례</h3><ul class="rel">${rel.map((x) => `<li><button type="button" data-id="${esc(x.id)}">${tag(x.판정)}<span>${esc(x.제목)}</span></button></li>`).join("")}</ul>` : ""}
    <p class="dnote">판정은 공개 답변을 검수해 붙인 것입니다. 원문과 다르면 연구지원팀에 알려 주세요. <button type="button" class="copy" id="copy">링크 복사</button></p>`;
  $("#doc").scrollTop = 0;
  if (push) history.replaceState(null, "", `#c=${encodeURIComponent(c.id)}`);
  if (matchMedia("(max-width: 1080px)").matches) $("#doc").scrollIntoView({ behavior: "smooth" });
}

// 이벤트
let t;
$("#q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { st.q = $("#q").value.trim(); if (st.q && st.sort !== "rel") { st.sort = "rel"; $("#sort").value = "rel"; } apply(); }, 150); });
$("#vChips").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; st.v.has(b.dataset.v) ? st.v.delete(b.dataset.v) : st.v.add(b.dataset.v); apply(); });
$("#sChips").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (!b) return; st.s.has(b.dataset.s) ? st.s.delete(b.dataset.s) : st.s.add(b.dataset.s); apply(); });
$("#toc").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (!b) return; st.b = b.dataset.b; apply(); });
$("#min").addEventListener("change", () => { st.m = $("#min").value; apply(); });
$("#sort").addEventListener("change", () => { st.sort = $("#sort").value; apply(); });
$("#reset").addEventListener("click", () => { st = { q: "", v: new Set(), s: new Set(), b: "", m: "", sort: "rel" }; $("#q").value = ""; $("#min").value = ""; $("#sort").value = "rel"; apply(); });
$("#list").addEventListener("click", (e) => { if (e.target.id === "moreBtn") return more(); const b = e.target.closest("[data-id]"); if (b) open(C.find((c) => c.id === b.dataset.id)); });
$("#doc").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]"); if (b) return open(C.find((c) => c.id === b.dataset.id));
  if (e.target.id === "copy") { navigator.clipboard?.writeText(location.href).then(() => (e.target.textContent = "복사됨"), () => {}); }
});
// 키보드: ↑↓로 목록 이동
document.addEventListener("keydown", (e) => {
  if (!cur || !["ArrowDown", "ArrowUp"].includes(e.key) || /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const i = hits.indexOf(cur) + (e.key === "ArrowDown" ? 1 : -1);
  if (i < 0 || i >= hits.length) return;
  e.preventDefault(); while (i >= shown) more(); open(hits[i]);
  $(`#list [data-id="${CSS.escape(hits[i].id)}"]`)?.scrollIntoView({ block: "nearest" });
});

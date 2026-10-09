"""전문기관 연구비 Q&A·FAQ 수집 → data/agency_cases.json  (토큰 0)

- 공개 글만, 답변이 있는 글만. 작성자·답변자 이름·연락처·이메일은 저장하지 않는다(답변 본문만).
- robots.txt가 막은 곳도 기관 결정(2026-10-10)에 따라 저속 수집(요청 간 3초). 차단·요청 시 해당 소스를 SOURCES에서 빼면 된다.
- 소스별 어댑터: list_pages(n) → [{key, url, title, public}], detail(item) → {질의, 답변, 작성일, 분류} 또는 None
- 증분: data/agency_state.json에 소스별 수집 완료 key 기록.
사용: python pipeline/crawl_agencies.py [--max-pages N] [--only 소스명]
"""
import html, json, re, sys, time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from crawl_qna import scrub

ROOT = Path(__file__).resolve().parent.parent
OUT, STATE = ROOT / "data" / "agency_cases.json", ROOT / "data" / "agency_state.json"
DELAY = 3
s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0 (compatible; POSTECH-research-fund-checker/1.0; biweekly)"


def get(url, **params):
    r = s.get(url, params=params, timeout=40)
    r.raise_for_status()
    time.sleep(DELAY)
    return r.text


def text_of(fragment):
    return scrub(re.sub(r"<br\s*/?>|</p>|</li>|</div>", "\n", fragment))


# ── IPET 농림식품기술기획평가원(농식품부) ─────────────────────
IPET = "https://www.ipet.re.kr/Rnd/"


def ipet_list(kind):
    def f(n):
        t = get(IPET + ("QnaLV.asp" if kind == "qna" else "FAQLV.asp"), **({"page": n} if kind == "qna" else {"Page": n}))
        out = []
        for m in re.finditer(r'<a href="((?:QnaVP|FAQVP)\.asp[^"]+)"([^>]*)>(.*?)</a>', t, re.S):
            href, attrs, title = html.unescape(m.group(1)), m.group(2), m.group(3)
            key = re.search(r"tbl_id=(\d+)", href).group(1)
            out.append({"key": key, "url": IPET + href, "title": text_of(title).replace("\n", " "), "public": "td-lock" not in attrs})
        return out
    return f


def ipet_detail(item):
    t = html.unescape(get(item["url"]))
    cell = lambda name: re.search(r"<th[^>]*>\s*" + name + r"\s*</th>\s*<td[^>]*>(.*?)</td>", t, re.S)
    if (c := cell("공개/비공개")) and "비공개" in c.group(1):
        return None
    q, a = cell("내용"), cell("답변내용")
    if not a:
        return None
    date, cat = cell("등록일"), cell("분류")
    return {"질의": text_of(q.group(1)) if q else "", "답변": text_of(a.group(1)),
            "작성일": text_of(date.group(1)) if date else "", "분류": text_of(cat.group(1)) if cat else ""}


# ── SMTECH 중소기업기술정보진흥원(중기부) FAQ ─────────────────
SMT = "https://www.smtech.go.kr/front/csg/fq/"


def smtech_faq_list(n):
    t = get(SMT + "faq_list.do", pageIndex=n)
    out = []
    for m in re.finditer(r'href="/front/csg/fq/faq_detail\.do[^"]*?bitmSeq=(\d+)[^"]*"[^>]*>(.*?)</a>', t, re.S):
        out.append({"key": m.group(1), "url": f"{SMT}faq_detail.do?bitmSeq={m.group(1)}", "title": text_of(m.group(2)), "public": True})
    return out


def smtech_faq_detail(item):
    t = get(SMT + "faq_detail.do", bitmSeq=item["key"])
    q = re.search(r"<th>질문</th>\s*<td[^>]*>(.*?)</td>", t, re.S)
    a = re.search(r'<td[^>]*class="[^"]*reply[^"]*"[^>]*>(.*?)</td>', t, re.S)
    cat = re.search(r"<th>구분</th>\s*<td>(.*?)</td>", t, re.S)
    if not a:
        return None
    return {"질의": text_of(q.group(1)) if q else "", "답변": text_of(html.unescape(a.group(1))), "작성일": "", "분류": text_of(cat.group(1)) if cat else ""}


SOURCES = {
    # 이름: (목록함수, 상세함수, 부처, 원문 안내 URL)
    "IPET 사업Q&A": (ipet_list("qna"), ipet_detail, ["농림축산식품부"], IPET + "QnaLV.asp"),
    "IPET 사업FAQ": (ipet_list("faq"), ipet_detail, ["농림축산식품부"], IPET + "FAQLV.asp"),
    "SMTECH FAQ": (smtech_faq_list, smtech_faq_detail, ["중소벤처기업부"], SMT + "faq_list.do"),
}


def crawl(name, max_pages, state, cases):
    lister, detailer, ministries, home = SOURCES[name]
    done = set(state.setdefault(name, []))
    n, new, seen_old = 1, 0, 0
    while n <= max_pages:
        rows = lister(n)
        if not rows:
            break
        for it in rows:
            if it["key"] in done:
                seen_old += 1
                continue
            done.add(it["key"])
            if not it["public"]:
                continue
            try:
                d = detailer(it)
            except requests.RequestException as e:
                print("상세 실패", name, it["key"], e); done.discard(it["key"]); continue
            if not d or len(d["답변"]) < 10:
                continue
            cases[f"{name}-{it['key']}"] = {
                "id": "ag-" + re.sub(r"\W", "", name.encode().hex()[:12]) + "-" + it["key"], "출처구분": "전문기관", "출처": name, "쪽": None, "유형": "게시판",
                "제목": it["title"][:160], "질의": d["질의"][:600] or it["title"], "답변": d["답변"][:1500], "분류": d.get("분류", ""),
                "작성일": d.get("작성일", ""), "원문URL": it["url"], "부처": ministries}
            new += 1
        if seen_old >= len(rows):  # 한 쪽 전체가 이미 수집된 글이면 이후는 이전 수집분
            break
        n += 1
    state[name] = sorted(done)
    print(f"{name}: {n}쪽, 신규 {new}건, 누적 {sum(1 for k in cases if k.startswith(name + '-'))}건")


if __name__ == "__main__":
    arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    max_pages, only = int(arg("--max-pages", 10**6)), arg("--only", None)
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    cases = {f"{c['출처']}-{c['id'].rsplit('-', 1)[1]}": c for c in (json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else [])}
    try:
        for name in SOURCES:
            if not only or only == name:
                crawl(name, max_pages, state, cases)
    finally:
        STATE.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        OUT.write_text(json.dumps(list(cases.values()), ensure_ascii=False, indent=1), encoding="utf-8")
        print("저장:", OUT.name, len(cases), "건")

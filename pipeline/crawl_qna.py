"""IRIS R&D 신문고(연구수행문의·FAQ) 공개 답변글 수집 → data/board_cases.json  (토큰 0)

- IRIS /contents/ 경로는 robots.txt 허용. NRF(nrf.re.kr)는 robots.txt가 'Disallow: /' 이지만
  기관 결정(2026-10-10)으로 공개·답변완료 글만 저속(요청 간 3초) 수집한다. 차단·요청 시 즉시 중단할 것.
- NRF는 답변완료 글이 14만 건이 넘어 실행마다 신규 글 + 과거 글 일부(--nrf-pages, --nrf-details)만 이어서 수집한다.
- 공개글(blltOpenRangSe == PG5002, 상세 화면 '공개여부: 공개')이면서 답변이 달린 글만 저장. 작성자 이름·연락처는 저장하지 않는다.
- 증분 수집: data/board_state.json에 마지막 글번호와 답변 대기 글을 기록. 요청 간 1.5초 지연.
사용: python pipeline/crawl_qna.py [--pages N] [--nrf-pages 150] [--nrf-details 1500] [--skip-iris|--skip-nrf]
"""
import base64, csv, html, json, re, sys, time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from classify_cases import bimok, verdict

ROOT = Path(__file__).resolve().parent.parent
OUT, STATE, NRF_CSV = ROOT / "data" / "board_cases.json", ROOT / "data" / "board_state.json", ROOT / "data" / "nrf_import.csv"
BASE = "https://www.iris.go.kr"
BOARDS = {  # 이름: (목록 화면, 목록 API, 상세, blbdId, 목록 키)
    "IRIS 연구수행문의": ("/contents/retrieveSmgAskRspdListView.do", "/contents/retrieveSmgAskRspdList.do", "/contents/retrieveSmgAskRspdView.do", "00000013", "listAskRspd"),
    "IRIS FAQ": ("/contents/retrieveFaqListView.do", "/contents/retrieveFaqList.do", "/contents/retrieveFaqView.do", "00000014", "listFaq"),
}
DELAY = 1.5

s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0 (compatible; POSTECH-research-fund-checker/1.0; biweekly)"


def scrub(t):
    """HTML 제거 + 개인정보(이메일·전화·주민번호 형태) 가림"""
    t = html.unescape(re.sub(r"<br\s*/?>", "\n", t))
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[이메일]", t)
    # 한글이 바로 붙는 경우("…9773으로")도 있어 \b 대신 숫자 경계로 판단
    t = re.sub(r"(?<!\d)0\d{1,2}[-. )]?\d{2,4}[-. ]?\d{4,5}(?!\d)", "[전화]", t)
    t = re.sub(r"(?<!\d)\d{6}-?[1-4]\d{6}(?!\d)", "[번호]", t)
    t = re.sub(r"([가-힣A-Za-z·]+(?:팀|부|실|센터|단|과))\s*[가-힣]{2,4}\s*(?:입니다|이며|드림)", r"\1 담당자입니다", t)  # 담당 직원 이름
    # 답변자 인사·연락처 문장은 통째로 뺌(이름·직함·번호가 섞여 있음): "○○실 홍길동 선임연구원입니다.", "…로 문의 바랍니다." 등
    TITLE = r"(?:선임연구원|책임연구원|전임연구원|선임|책임|주임|대리|과장|팀장|차장|부장|연구원)"
    sents = re.split(r"(?<=[.!?])\s+|\n", t)
    drop = lambda x: (re.search(r"\[전화\]|\[이메일\]|(?<!\d)\d{4}(?:~\d)?(?:,\s*\d{4})+|연락\s?(?:주|부탁|바랍|하시)|(?:문의|연락)(?:해|하여)?\s?주시|문의\s?(?:바랍|부탁|하시기|주십|드리)", x)
                      or re.search(r"[가-힣]{2,4}\s?" + TITLE + r"\s?(?:입니다|이며|\()", x)
                      or re.search(r"(?:담당자|실|팀)\s+[가-힣]{2,4}\s*\(", x)
                      or re.fullmatch(r"\s*(?:[가-힣A-Za-z]+(?:실|팀|부|센터)\s+)?[가-힣]{2,4}(?<![다요함음됨임까])(?:\s?드림)?\s*", x)  # 서명 줄(이름만)
                      or (len(x) <= 50 and re.search(r"(?:실|팀|부|센터|평가원|담당자)(?:에|의)?\s*[가-힣]{2,4}\s?입니다", x)))
    t = "\n".join(x for x in sents if x.strip() and not drop(x))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", t)).strip()


def page(board, n):
    view, api, _, bid, key = BOARDS[board]
    r = s.post(BASE + api, data={"pageIndex": n, "prgmId": "", "search": "search", "blbdId": bid}, timeout=30)
    r.raise_for_status()
    d = json.loads(base64.b64decode(r.text).decode("utf-8"))
    return d[key], d["paginationInfo"]["totalPageCount"]


def detail(board, x):
    _, _, url, _, _ = BOARDS[board]
    r = s.post(BASE + url, data={"blbdId": x["blbdId"], "blltSeq": x["blltSeq"], "blltClSe": x.get("blltClSe") or "", "prgmId": ""}, timeout=30)
    r.raise_for_status()
    t = r.text
    q = re.search(r'id\s*=\s*"blltCn"[^>]*>(.*?)</div>', t, re.S)
    a = re.findall(r'class="reply_txt">(.*?)</div>', t, re.S)
    d = re.search(r'class="date">\s*([\d/]+)', t)
    field = re.search(r"질의 분야\(중분류\)</strong>\s*<span>([^<]*)", t)
    if board != "IRIS FAQ" and not re.search(r"공개여부</strong>\s*<span>\s*공개\s*<", t):
        return "", "", "", ""  # 상세 화면에서 '공개'가 아니면 저장하지 않음
    if board == "IRIS FAQ":  # FAQ는 운영단 안내문 자체가 답변(숨은 input에 이스케이프된 HTML)
        m = re.search(r"name=\"blltCn\" value='(.*?)'/>", t, re.S)
        return "", (scrub(html.unescape(m.group(1))) if m else ""), "", ""
    org = re.search(r"소관 전문기관</strong>\s*<span>([^<]*)", t)  # 부처별 사례 구분에 사용
    return (scrub(q.group(1)) if q else ""), scrub("\n".join(a)), (d.group(1) if d else ""), (field.group(1).strip() if field else "") + "|" + (org.group(1).strip() if org else "")


def to_case(board, x, q, a, date, field):
    field, _, org = field.partition("|")
    title = html.unescape(x["blltTl"]).strip()
    v, why = verdict(a, "Q&A")
    return {
        "id": f"iris-{x['blltSeq']}", "출처구분": "IRIS", "출처": board, "쪽": None, "유형": "게시판",
        "제목": title[:160], "질의": q[:600] or title, "답변": a[:1500], "비목": bimok(f"{title} {field} {q[:300]}"),
        "판정": v, "판정근거": why, "작성일": x.get("frstRegYmd", ""),
        **({"유형": "FAQ"} if board == "IRIS FAQ" else {}), "답변일": date,
        "원문URL": (f"{BASE}/contents/retrieveFaqView.do?blbdId={x['blbdId']}&blltSeq={x['blltSeq']}&prgmId=" if board == "IRIS FAQ" else BASE + BOARDS[board][0]),
        "게시번호": x["blltSeq"], "전문기관": org,
    }


def crawl(max_pages, state, cases):
    for board in BOARDS:
        st = state.setdefault(board, {"maxSeq": 0, "pending": []})
        s.get(BASE + BOARDS[board][0], timeout=30)  # 세션 쿠키
        new_max, todo, n, total = st["maxSeq"], [], 1, 1
        while n <= min(total, max_pages):
            rows, total = page(board, n)
            time.sleep(DELAY)
            fresh = [x for x in rows if x["blltSeq"] > st["maxSeq"]]
            new_max = max([new_max] + [x["blltSeq"] for x in rows])
            todo += [x for x in fresh if board == "IRIS FAQ" or x.get("blltOpenRangSe") == "PG5002"]  # PG5002=공개만 (PG5001·PG5004는 비공개)
            if len(fresh) < len(rows):  # 이전 수집 지점 도달
                break
            n += 1
        todo += [x for x in st["pending"] if f"iris-{x['blltSeq']}" not in cases]
        still = []
        for x in todo:
            try:
                q, a, date, field = detail(board, x)
            except requests.RequestException as e:
                print("상세 실패", board, x["blltSeq"], e); still.append(x); continue
            finally:
                time.sleep(DELAY)
            if a:
                cases[f"iris-{x['blltSeq']}"] = to_case(board, x, q, a, date, field)
            else:
                still.append({k: x[k] for k in ("blltSeq", "blbdId", "blltClSe", "blltTl", "frstRegYmd") if k in x})
        st["maxSeq"], st["pending"] = new_max, still[-300:]  # 답변 대기는 최근 300건만 재확인
        print(f"{board}: 목록 {n}쪽, 신규·재확인 {len(todo)}건, 누적 {sum(c['출처'] == board for c in cases.values())}건")
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")  # 게시판별 중간 저장


NRF = "https://www.nrf.re.kr"
NRF_LIST = NRF + "/page/47"
NRF_DELAY = 3


def nrf_list(n):
    # 답변완료(5)만, 한 쪽 100건
    r = s.get(NRF_LIST, params={"menuNo": 47, "pageNum": n, "pageSize": 100, "searchSplitNtsStatusCd": 5}, timeout=60)
    r.raise_for_status()
    t = r.text
    rows = []
    for m in re.finditer(r'data-post_no="(\d+)"\s+data-post_close_yn="([YN])".*?data-biz_cat_nm="([^"]*)".*?>([^<]*)</a>(.*?)table-list-date">([\d-]+)', t, re.S):
        no, close, cat, title, _, d = m.groups()
        rows.append({"no": int(no), "open": close == "N", "cat": html.unescape(cat), "title": html.unescape(title).strip(), "date": d})
    return rows


def nrf_detail(no):
    r = s.get(NRF + "/biz/qna/view", params={"ac": "view", "menuNo": 47, "postNo": no}, headers={"Referer": NRF_LIST + "?menuNo=47"}, timeout=60)
    r.raise_for_status()
    grab = lambda cls: re.search(r'class="' + cls + r'[^"]*"[^>]*>(.*?)</div>', r.text, re.S)
    q, a = grab("view-body"), re.findall(r'class="answer-editor[^"]*"[^>]*>(.*?)</div>', r.text, re.S)
    return (scrub(q.group(1)) if q else ""), scrub("\n".join(a))


def nrf_case(x, q, a):
    v, why = verdict(a, "Q&A")
    return {"id": f"nrf-{x['no']}", "출처구분": "NRF", "출처": "NRF 사업질의응답", "쪽": None, "유형": "게시판",
            "제목": x["title"][:160], "질의": q[:600] or x["title"], "답변": a[:1500], "비목": bimok(f"{x['title']} {q[:300]}"),
            "판정": v, "판정근거": why, "작성일": x["date"], "사업": x["cat"].strip("[]"),
            "원문URL": f"{NRF}/biz/qna/view?ac=view&menuNo=47&postNo={x['no']}", "게시번호": x["no"]}


def crawl_nrf(state, cases, max_pages, max_details):
    st = state.setdefault("NRF 사업질의응답", {"maxNo": 0, "backfillPage": 1, "backfillDone": False})
    todo, pages = [], 0
    # 1) 새 글: 1쪽부터 이전 최대 번호에 닿을 때까지
    n = 1
    while pages < max_pages:
        rows = nrf_list(n); pages += 1; time.sleep(NRF_DELAY)
        todo += [x for x in rows if x["open"] and x["no"] > st["maxNo"]]
        if not rows or min(x["no"] for x in rows) <= st["maxNo"] or st["maxNo"] == 0:
            break
        n += 1
    top = max([st["maxNo"]] + [x["no"] for x in todo])
    # 2) 과거 글 이어받기
    while not st["backfillDone"] and pages < max_pages:
        rows = nrf_list(st["backfillPage"]); pages += 1; time.sleep(NRF_DELAY)
        if not rows:
            st["backfillDone"] = True; break
        todo += [x for x in rows if x["open"]]
        st["backfillPage"] += 1
    got = 0
    for x in [x for x in todo if f"nrf-{x['no']}" not in cases][:max_details]:
        try:
            q, a = nrf_detail(x["no"])
        except requests.RequestException as e:
            print("NRF 상세 실패", x["no"], e); continue
        finally:
            time.sleep(NRF_DELAY)
        if a:
            cases[f"nrf-{x['no']}"] = nrf_case(x, q, a); got += 1
    st["maxNo"] = top
    print(f"NRF 사업질의응답: 목록 {pages}쪽, 공개 후보 {len(todo)}건, 신규 저장 {got}건, 과거글 진행 {st['backfillPage']}쪽{' (완료)' if st['backfillDone'] else ''}")


def nrf_manual():
    """NRF 사업질의응답은 robots.txt로 자동 수집이 금지되어 있어 수동 정리본(CSV)만 반영"""
    if not NRF_CSV.exists():
        return []
    out = []
    with NRF_CSV.open(encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f)):
            if not r.get("답변"):
                continue
            v, why = verdict(r["답변"], "Q&A")
            out.append({"id": f"nrfcsv-{i}", "출처구분": "NRF", "출처": "NRF 사업질의응답", "쪽": None, "유형": "게시판",
                        "제목": r["제목"][:160], "질의": scrub(r.get("질의", ""))[:600], "답변": scrub(r["답변"])[:1500],
                        "비목": bimok(r["제목"] + " " + r.get("질의", "")), "판정": v, "판정근거": why,
                        "작성일": r.get("작성일", ""), "원문URL": r.get("원문URL") or "https://www.nrf.re.kr/page/47?menuNo=47"})
    return out


if __name__ == "__main__":
    assert scrub("가능합니다. 연락처 010-1234-5678, a.b@postech.ac.kr") == "가능합니다."  # 연락처 문장은 통째로 제외
    assert scrub("가능합니다. 061-338-9773으로 연락주시기 바랍니다.") == "가능합니다."
    assert scrub("○○실 홍길동 선임연구원입니다. 집행 가능합니다.") == "집행 가능합니다."
    assert "임보혜" not in scrub("이공학술지원팀 임보혜 입니다. 집행 가능합니다.")  # 담당자 인사 문장은 제거
    arg = lambda k, d: int(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    cases = {c["id"]: c for c in (json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else []) if not c["id"].startswith("nrfcsv-")}
    try:
        if "--skip-iris" not in sys.argv:
            crawl(arg("--pages", 10**6), state, cases)
        if "--skip-nrf" not in sys.argv:
            crawl_nrf(state, cases, arg("--nrf-pages", 150), arg("--nrf-details", 1500))
    finally:  # 중간에 끊겨도 받은 만큼 저장
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        out = list(cases.values()) + nrf_manual()
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print("저장:", OUT.name, len(out), "건")

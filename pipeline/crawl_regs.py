"""모든 부처 R&D 연구비 규정 격주 점검 (법제처 국가법령정보 Open API, 토큰 0)

- robots.txt: law.go.kr 허용 / ntis.go.kr·nrf.re.kr 은 'Disallow: /' 이라 자동 수집하지 않는다.
- 검색어별 현행 행정규칙(고시·훈령·예규)과 법령을 목록화 → data/regs_catalog.json
- 이전 목록과 비교해 신규·개정된 규정은 전문을 받아 참고자료/_수집/YYYYMMDD/ 에 저장하고
  data/text_regs/ 에도 넣어 근거 검색에 쓴다.
- 변경 내역은 reports/YYYYMMDD_규정변경.md 로 남긴다 → update-reviewer 에이전트가 rules.json 반영 검토.
환경변수 LAW_OC: law.go.kr Open API 인증값(신청한 이메일 ID). 없으면 'test'(시험용, 호출 제한 있음).
"""
import difflib, json, os, re, sys, time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CATALOG, TEXT = ROOT / "data" / "regs_catalog.json", ROOT / "data" / "text_regs"  # 참고자료 추출본(data/text)과 분리
TODAY = date.today().strftime("%Y%m%d")
SAVE, REPORT = ROOT / "참고자료" / "_수집" / TODAY, ROOT / "reports" / f"{TODAY}_규정변경.md"
OC = os.environ.get("LAW_OC", "test")
API = "https://www.law.go.kr/DRF"

# 부처 구분 없이 R&D 연구비 관련 규정을 잡는 검색어
QUERIES = ["연구개발비", "국가연구개발", "연구개발사업", "기술개발사업", "연구개발과제", "학생인건비", "연구시설", "기술료", "연구개발 혁신", "산업기술혁신", "R&D"]
KEEP = re.compile(r"연구개발|기술개발|R&D|연구비|학생인건비|연구시설|기술료|산업기술혁신|연구장비")
LAWS = ["국가연구개발혁신법", "국가연구개발혁신법 시행령", "국가연구개발혁신법 시행규칙"]


def get(path, **params):
    for attempt in range(3):
        try:
            r = requests.get(f"{API}/{path}", params={"OC": OC, "type": "JSON", **params}, timeout=30)
            r.raise_for_status()
            time.sleep(1)
            return r.json()
        except (requests.RequestException, ValueError) as e:
            print("재시도", path, params.get("query") or params.get("ID"), e)
            time.sleep(5)
    raise RuntimeError(f"law.go.kr 응답 없음: {path} {params}")


def search():
    found = {}
    for q in QUERIES:
        page = 1
        while True:
            d = get("lawSearch.do", target="admrul", query=q, display=100, page=page)["AdmRulSearch"]
            rows = d.get("admrul") or []
            rows = [rows] if isinstance(rows, dict) else rows
            for r in rows:
                if r.get("현행연혁구분") == "현행" and KEEP.search(r["행정규칙명"]):
                    found[r["행정규칙ID"]] = {"종류": r["행정규칙종류"], "이름": r["행정규칙명"], "부처": r["소관부처명"],
                                         "발령일자": r["발령일자"], "시행일자": r["시행일자"], "일련번호": r["행정규칙일련번호"], "target": "admrul"}
            if page * 100 >= int(d.get("totalCnt", 0)):
                break
            page += 1
    for name in LAWS:
        rows = get("lawSearch.do", target="law", query=name, display=20)["LawSearch"].get("law") or []
        rows = [rows] if isinstance(rows, dict) else rows
        for r in rows:
            if r["법령명한글"] == name:
                found[r["법령ID"]] = {"종류": r["법령구분명"], "이름": name, "부처": r["소관부처명"], "발령일자": r["공포일자"],
                                    "시행일자": r["시행일자"], "일련번호": r["법령일련번호"], "target": "law"}
    return found


def fulltext(meta):
    if meta["target"] == "law":
        d = get("lawService.do", target="law", MST=meta["일련번호"])["법령"]
        units = d["조문"]["조문단위"]
        units = [units] if isinstance(units, dict) else units
        arts = [u.get("조문내용", "") + "\n" + "\n".join(h.get("항내용", "") for h in (u.get("항") if isinstance(u.get("항"), list) else [u["항"]] if u.get("항") else []) if isinstance(h, dict)) for u in units]
    else:
        d = get("lawService.do", target="admrul", ID=meta["일련번호"])["AdmRulService"]
        arts = d.get("조문내용") or []
        arts = [arts] if isinstance(arts, str) else arts
    flat = lambda a: "\n".join(flat(x) for x in a) if isinstance(a, list) else str(a)
    return re.sub(r"[ \t]+", " ", "\n".join(flat(a) for a in arts)).strip()


def safe(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name)


if __name__ == "__main__":
    old = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else {}
    new = search()
    added = [k for k in new if k not in old]
    changed = [k for k in new if k in old and new[k]["일련번호"] != old[k]["일련번호"]]
    removed = [k for k in old if k not in new]
    first_run = not old
    lines = [f"# 규정 변경 점검 {TODAY}", "", f"- 모니터링 규정: {len(new)}종 (부처 {len({v['부처'] for v in new.values()})}곳)",
             f"- 신규 {len(added)} · 개정 {len(changed)} · 폐지/검색제외 {len(removed)}", ""]
    SAVE.mkdir(parents=True, exist_ok=True)
    for k in changed + added:  # 첫 실행은 전체 원문을 받아 기준본으로 저장
        m = new[k]
        try:
            body = fulltext(m)
        except (RuntimeError, KeyError, TypeError) as e:
            lines += [f"- 원문 수신 실패: {m['이름']} ({e})"]; continue
        fn = f"{safe(m['이름'])}({m['시행일자']})"
        (SAVE / f"{fn}.txt").write_text(body, encoding="utf-8")
        # 사이트 근거 검색용: 조문 40줄 단위 가상 쪽
        ls = body.split("\n")
        (TEXT / f"{fn}.json").write_text(json.dumps([{"page": i // 40 + 1, "text": "\n".join(ls[i:i + 40])} for i in range(0, len(ls), 40)], ensure_ascii=False), encoding="utf-8")
        lines += [f"## {'개정' if k in changed else '신규'}: {m['이름']} ({m['부처']} {m['종류']}, 시행 {m['시행일자']})", ""]
        prev = ROOT / "참고자료" / "_수집" / "latest" / f"{safe(m['이름'])}.txt"
        if prev.exists():
            diff = list(difflib.unified_diff(prev.read_text(encoding="utf-8").split("\n"), ls, "이전", "현행", n=0, lineterm=""))
            lines += ["```diff", *diff[:200], "```", ""]
        prev.parent.mkdir(parents=True, exist_ok=True)
        prev.write_text(body, encoding="utf-8")
    if removed:
        lines += ["## 폐지 또는 검색에서 빠진 규정", *[f"- {old[k]['이름']} ({old[k]['부처']})" for k in removed], ""]
    if OC == "test":
        lines = ["> ⚠️ **리마인드: 법제처 Open API 인증키(LAW_OC) 미설정** - 시험값 'test'로 실행 중입니다. "
                 "https://open.law.go.kr 에서 받은 키를 사용자 환경변수 LAW_OC로 등록하세요.", ""] + lines
    lines += ["## 다음 할 일", "- 개정 조문이 rules.json 근거와 관련 있으면 update-reviewer 에이전트로 반영 검토",
              "- 매뉴얼(PDF)·사례집은 Open API에 없으므로 IRIS·NRF 공지에서 신판 여부를 사람이 확인"]
    CATALOG.write_text(json.dumps(new, ensure_ascii=False, indent=1), encoding="utf-8")
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:5]))
    sys.exit(0)

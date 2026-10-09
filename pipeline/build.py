"""rules.json + cases.json + 원문 → docs/data.json (사이트가 읽는 단일 파일). 토큰 0.

- 규칙 근거마다 원문 발췌(해당 쪽에서 조항명과 가장 많이 겹치는 문단)를 붙인다.
- Q&A가 없는 규정(POSTECH 내규·운영요령·기술료)은 조문 단위로 '규정조항' 사례를 만든다.
- 스키마 검증: 모든 규칙·사례에 근거가 있어야 한다.
"""
import hashlib, json, re, sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from classify_cases import NEG, COND, bimok, doc_name  # 같은 분류 기준 재사용

ROOT = Path(__file__).resolve().parent.parent
DATA, TEXT, OUT = ROOT / "data", ROOT / "data" / "text", ROOT / "docs" / "data.json"
NO_QA = ("연구비관리지침", "여비규정", "여비집행지침", "계약규정", "연구업무규정", "운영지침", "산업기술혁신사업", "기술료제도")


def grams(s):
    s = re.sub(r"\s+", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def load_text():
    from extract import load_pages  # PDF 줄바꿈 복원본
    return {doc_name(k): v for k, v in load_pages().items()}


def load_regs():
    """부처 소관 규정(법제처 수집본, crawl_regs): 부처별 규칙의 근거 인용에만 사용"""
    return {re.sub(r"\(\d{8}\)$", "", f.stem): json.loads(f.read_text(encoding="utf-8")) for f in sorted((DATA / "text_regs").glob("*.json"))}


def excerpt(pages, page, hint, find=None):
    pg = next((p for p in pages if p["page"] == page), None)
    if not pg:
        return ""
    if find:  # 수동 지정: 해당 문자열이 있는 줄부터 (쪽이 틀렸으면 문서 전체에서 찾아 바로잡음)
        if find not in pg["text"]:
            pg = next((p for p in pages if find in p["text"]), None)
            assert pg, f"발췌 문자열 없음: {find} (p{page})"
            print(f"  쪽 보정: '{find[:20]}' p{page} → p{pg['page']}")
        i = pg["text"].find(find)
        start = pg["text"].rfind("\n", 0, i) + 1
        if i - start > 200:  # 줄바꿈 없는 법제처 본문: 찾은 항·호부터 다음 항·조 전까지
            t = pg["text"][i:]
            end = re.search(r"(?<=.{10})(?:[①-⑳]|제\d+조(?:의\d+)?\(|(?<=[가-힣)])\d{1,2}\.\s?(?=[가-힣]))", t)
            return t[:end.start() if end else 420][:420]
        return re.sub(r"\s*\n\s*", " ", pg["text"][start:])[:420]
    paras = [x for x in re.split(r"\n(?=\s*(?:[-➊➋➌➍➎➏①②③④⑤⑥⑦⑧∙•※]|\d+\.|제\d+조|[가-하]\.))", pg["text"]) if len(x) > 20]
    h = grams(hint)
    best = max(paras, key=lambda x: len(grams(x) & h) / len(grams(x)) ** 0.5, default="")  # 짧고 밀도 높은 문단 우선
    return re.sub(r"\s*\n\s*", " ", best)[:420]


def find_doc(texts, short):
    return next((v for k, v in texts.items() if short.replace("POSTECH ", "") in k or k.startswith(short)), None)


def article_cases(texts):
    out = []
    for name, pages in texts.items():
        if not any(k in name for k in NO_QA):
            continue
        full = "".join(f"\n<<{p['page']}>>\n" + p["text"] for p in pages)
        for m in re.finditer(r"(?m)^\s*(제\d+조(?:의\d+)?)\s*\(([^)]{2,30})\)(.*?)(?=^\s*제\d+조(?:의\d+)?\s*\(|^\s*부\s*칙|\Z)", full, re.S):
            no, title, body = m.groups()
            body = re.sub(r"<<\d+>>", "", body).strip()
            if "삭제" in body[:20] or len(body) < 40:
                continue
            if not re.search(r"연구비|연구개발비|집행|지급|계상|사용|출장|여비|구입|계약|정산", body):
                continue
            page = int((re.findall(r"<<(\d+)>>", full[:m.start()]) or [1])[-1])
            # 조문은 허용·금지가 섞여 있어 키워드 판정이 의미 없음 → 근거 조항으로만 보여줌
            v, why = "참고", "규정 조항"
            out.append({
                "id": "art-" + hashlib.md5((name + no).encode()).hexdigest()[:8], "출처구분": "참고자료", "출처": name, "쪽": page,
                "유형": "규정조항", "제목": f"{no}({title})", "질의": f"{name} {no}({title})",
                "답변": re.sub(r"\s*\n\s*", " ", body)[:900], "비목": bimok(title + " " + body[:300]),
                "판정": v, "판정근거": why, "부처": ["산업통상부"] if "산업기술혁신사업" in name else ["공통"],
            })
    return out


# 부처별 R&D 관리 규정(법제처 목록)에서 연구비 집행과 직접 관련된 것만 추림
REG_PAT = re.compile(r"처리\s?규[정칙]|관리\s?규정|운영\s?(요령|규정)|운영관리\s?규정|관리\s?등에 관한 규정|사업관리규정|지급.*사용|연구개발비")
REG_SKIP = re.compile(r"이어달리기|심의위원회|보안|평가관리|경제성|비중 산정")


def ministry_regs():
    cat = json.loads((DATA / "regs_catalog.json").read_text(encoding="utf-8")) if (DATA / "regs_catalog.json").exists() else {}
    out = {}
    for v in cat.values():
        if not REG_PAT.search(v["이름"]) or REG_SKIP.search(v["이름"]):
            continue
        kind = "법령" if v["target"] == "law" else "행정규칙"
        item = {"이름": v["이름"], "종류": v["종류"], "시행일": v["시행일자"], "url": f"https://www.law.go.kr/{kind}/{v['이름']}"}
        for m in v["부처"].split(","):
            out.setdefault(m.strip(), []).append(item)
    for m in out:  # 부처 소관 전반 규정(처리규정·운영규정)을 사업별 규정보다 앞에
        out[m].sort(key=lambda x: (not re.search(r"소관|처리|공통 운영요령|연구개발사업 운영규정", x["이름"]), x["이름"]))
    return out


def validate(rules, cases):
    errs = []
    for r in rules["rules"]:
        if not r["base"]["근거"]:
            errs.append(f"{r['id']}: base 근거 없음")
        for c in r["checks"] + r["agree"]:
            if not c.get("근거"):
                errs.append(f"{r['id']}: 근거 없는 조건 {c}")
            for f, op, v in c["when"]:
                assert op in ("==", "!=", ">", ">=", "<", "<="), op
    for c in cases:
        if c["판정"] not in ("인정", "불인정", "판단필요", "참고"):
            errs.append(f"{c['id']}: 판정값 {c['판정']}")
        if not (c.get("쪽") or c.get("원문URL")):
            errs.append(f"{c['id']}: 근거 위치 없음")
    assert not errs, "\n".join(errs[:20])


if __name__ == "__main__":
    texts, regs = load_text(), load_regs()
    rules = json.loads((DATA / "rules.json").read_text(encoding="utf-8"))
    cases = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))
    # IRIS 연구수행문의는 상세 화면에서 '공개'를 확인하며 전문기관을 기록한 글만 게시(목록 코드만으로는 비공개글이 섞일 수 있음)
    cases = [c for c in cases if c["유형"] != "규정조항" and (c["출처"] != "IRIS 연구수행문의" or c.get("전문기관"))] + article_cases(texts)
    for r in rules["rules"]:
        for c in [r["base"]] + r["checks"] + r["agree"]:
            for g in c["근거"]:
                pages = find_doc(texts, g["문서"]) if g.get("출처") != "법제처" else find_doc(regs, g["문서"])
                assert pages, f"문서 없음: {g['문서']}"
                g["발췌"] = excerpt(pages, g["쪽"], g["조항"] + " " + c.get("사유", c.get("내용", "")), g.get("find"))
                if g.get("find") and not any(p["page"] == g["쪽"] and g["find"] in p["text"] for p in pages):
                    g["쪽"] = next(p["page"] for p in pages if g["find"] in p["text"])  # 보정된 쪽 반영
    validate(rules, cases)
    # 질문별 적용 과제구분: 그 질문을 쓰는 조건들의 track 조건에서 자동 도출 (해당 부처에서만 질문을 보여 주기 위함)
    ALL = {t["id"] for t in rules["tracks"]}
    for r in rules["rules"]:
        for q in r["questions"]:
            ts, ms = set(), set()  # ms: 특정 부처에서만 쓰는 질문이면 그 부처들, 하나라도 부처 무관이면 None
            for c in r["checks"] + r["agree"]:
                if any(k == q["id"] for k, _, _ in c["when"]):
                    t = ALL.copy()
                    for k, op, v in c["when"]:
                        if k == "track":
                            t &= {v} if op == "==" else ALL - {v}
                    ts |= t
                    only = [v for k, op, v in c["when"] if k == "ministry" and op == "=="]
                    ms = ms | set(only) if ms is not None and only else None
            assert ts, f"쓰이지 않는 질문: {r['id']}.{q['id']}"
            q["tracks"] = sorted(ts)
            if ms:
                q["ministries"] = sorted(ms)
    # 공개 사이트: POSTECH 내규는 조항 번호와 요지만 (전문은 학내 규정집)
    gist = lambda t: t if len(t) <= 200 else t[:200].rstrip() + "… (전문은 POSTECH 규정집 참고)"
    for c in cases:
        if c["출처"].startswith("POSTECH"):
            c["답변"] = gist(c["답변"])
    for r in rules["rules"]:
        for c in [r["base"]] + r["checks"] + r["agree"]:
            for g in c["근거"]:
                if g["문서"].startswith("POSTECH"):
                    g["발췌"] = gist(g["발췌"])
    ministries = ministry_regs()
    docs = sorted({c["출처"] for c in cases} | set(texts))
    meta = {"기준일": date.today().isoformat(), "문서": docs,
            "사례수": len(cases), "게시판수": sum(c["출처구분"] != "참고자료" for c in cases)}
    slim = [{k: c[k] for k in ("id", "출처구분", "출처", "쪽", "유형", "제목", "답변", "비목", "판정", "판정근거")} | {"부처": c.get("부처", ["공통"])} | ({"원문URL": c["원문URL"]} if c.get("원문URL") else {}) | ({"자동": 1} if c.get("자동") else {}) for c in cases]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "tracks": rules["tracks"], "ministries": ministries, "rules": rules["rules"], "cases": slim}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(f"OK {OUT.name}: {OUT.stat().st_size // 1024}KB, 규칙 {len(rules['rules'])}, 사례 {len(cases)}", Counter(c["판정"] for c in cases))
    print("문서별:", Counter(c["출처"] for c in cases).most_common())

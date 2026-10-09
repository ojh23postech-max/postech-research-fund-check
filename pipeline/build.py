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
    return {doc_name(f.stem): json.loads(f.read_text(encoding="utf-8")) for f in TEXT.glob("*.json")}


def excerpt(pages, page, hint, find=None):
    pg = next((p for p in pages if p["page"] == page), None)
    if not pg:
        return ""
    if find:  # 수동 지정: 해당 문자열이 있는 줄부터
        i = pg["text"].find(find)
        assert i >= 0, f"발췌 문자열 없음: {find} (p{page})"
        return re.sub(r"\s*\n\s*", " ", pg["text"][pg["text"].rfind("\n", 0, i) + 1:])[:420]
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
            neg, cond = re.search(NEG, body), re.search(COND, body)
            v = "불인정" if neg else "판단필요" if cond else "인정"
            why = (neg or cond).group(0) if (neg or cond) else "허용 조항"
            out.append({
                "id": "art-" + hashlib.md5((name + no).encode()).hexdigest()[:8], "출처구분": "참고자료", "출처": name, "쪽": page,
                "유형": "규정조항", "제목": f"{no}({title})", "질의": f"{name} {no}({title})",
                "답변": re.sub(r"\s*\n\s*", " ", body)[:900], "비목": bimok(title + " " + body[:300]),
                "판정": v, "판정근거": why,
            })
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
        if c["판정"] not in ("인정", "불인정", "판단필요"):
            errs.append(f"{c['id']}: 판정값 {c['판정']}")
        if not (c.get("쪽") or c.get("원문URL")):
            errs.append(f"{c['id']}: 근거 위치 없음")
    assert not errs, "\n".join(errs[:20])


if __name__ == "__main__":
    texts = load_text()
    rules = json.loads((DATA / "rules.json").read_text(encoding="utf-8"))
    cases = json.loads((DATA / "cases.json").read_text(encoding="utf-8"))
    cases = [c for c in cases if c["유형"] != "규정조항"] + article_cases(texts)
    for r in rules["rules"]:
        for c in [r["base"]] + r["checks"] + r["agree"]:
            for g in c["근거"]:
                pages = find_doc(texts, g["문서"])
                assert pages, f"문서 없음: {g['문서']}"
                g["발췌"] = excerpt(pages, g["쪽"], g["조항"] + " " + c.get("사유", c.get("내용", "")), g.get("find"))
    validate(rules, cases)
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
    docs = sorted({c["출처"] for c in cases} | set(texts))
    meta = {"기준일": date.today().isoformat(), "문서": docs,
            "사례수": len(cases), "게시판수": sum(c["출처구분"] != "참고자료" for c in cases)}
    slim = [{k: c[k] for k in ("id", "출처구분", "출처", "쪽", "유형", "제목", "답변", "비목", "판정", "판정근거")} | ({"원문URL": c["원문URL"]} if c.get("원문URL") else {}) for c in cases]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "tracks": rules["tracks"], "rules": rules["rules"], "cases": slim}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(f"OK {OUT.name}: {OUT.stat().st_size // 1024}KB, 규칙 {len(rules['rules'])}, 사례 {len(cases)}", Counter(c["판정"] for c in cases))
    print("문서별:", Counter(c["출처"] for c in cases).most_common())

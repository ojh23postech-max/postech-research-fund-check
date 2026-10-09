"""참고자료/ 원문(PDF·HWP·HWPX) → data/text/<문서>.json  [{page, text}]  (토큰 0)"""
import json, re, struct, sys, zipfile, zlib
from pathlib import Path

import olefile
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "참고자료", ROOT / "data" / "text"


def gutter(pg):
    """양면 펼침(가로로 긴 쪽)이면 두 쪽 사이 x좌표, 아니면 None. 가운데 영역에서 가로지르는 단어가 없는 세로선을 찾음.
    세로 쪽의 표·곁단은 줄이 단을 넘나들어 나누면 문장이 잘리므로 대상에서 뺌"""
    w = pg.extract_words()
    if pg.width <= pg.height or len(w) < 60:
        return None
    hit = lambda x: sum(1 for a in w if a["x0"] < x + 4 and x - 4 < a["x1"])  # 8pt 폭 빈 띠를 가로지르는 단어 수
    x = min(range(int(pg.width * .35), int(pg.width * .65), 2), key=lambda x: (hit(x), abs(x - pg.width / 2)))
    cross = hit(x)
    left = sum(1 for a in w if a["x1"] <= x)
    return x if cross == 0 and 0.25 < left / len(w) < 0.75 else None


def pdf_pages(p):
    with pdfplumber.open(p) as pdf:
        out = []
        for i, pg in enumerate(pdf.pages):
            pg = pg.within_bbox(pg.bbox)  # 쪽 밖에 놓인 글자(인쇄 판면의 이웃 쪽 등) 제외
            x = gutter(pg)
            parts = [pg.crop((0, 0, x, pg.height)), pg.crop((x, 0, pg.width, pg.height))] if x else [pg]  # 왼쪽 단 → 오른쪽 단
            t = "\n".join(c.extract_text() or "" for c in parts)
            out.append({"page": i + 1, "text": t})
        return out


def hwp5_text(p):
    # HWP5(OLE): BodyText/SectionN 레코드 중 PARA_TEXT(tag 67)만 UTF-16 디코드
    ole = olefile.OleFileIO(str(p))
    compressed = ole.openstream("FileHeader").read()[36] & 1
    paras = []
    for s in sorted(e for e in ole.listdir() if e[0] == "BodyText"):
        data = ole.openstream(s).read()
        if compressed:
            data = zlib.decompress(data, -15)
        i = 0
        while i < len(data):
            h = struct.unpack_from("<I", data, i)[0]
            tag, size = h & 0x3FF, h >> 20
            i += 4
            if size == 0xFFF:
                size = struct.unpack_from("<I", data, i)[0]; i += 4
            if tag == 67:
                t = data[i:i + size].decode("utf-16le", "ignore")
                paras.append(re.sub(r"[\x00-\x1f]", "", t))  # 인라인 제어문자 제거
            i += size
    return paras


def hwpx_text(p):
    with zipfile.ZipFile(p) as z:
        xml = "".join(z.read(n).decode("utf-8") for n in sorted(z.namelist()) if n.startswith("Contents/section"))
    return [re.sub(r"<[^>]+>", "", m) for m in re.findall(r"<hp:p\b.*?</hp:p>", xml, re.S)]


def extract(p):
    if p.suffix.lower() == ".pdf":
        return pdf_pages(p)
    paras = hwp5_text(p) if olefile.isOleFile(str(p)) else hwpx_text(p)
    # HWP는 쪽 정보가 없어 40문단 단위로 가상 쪽을 나눔
    return [{"page": n // 40 + 1, "text": "\n".join(paras[n:n + 40])} for n in range(0, len(paras), 40)]


# ── PDF 줄바꿈 복원 ─────────────────────────────────────────────
# PDF는 화면 폭에서 줄을 끊어(단어 중간 포함) 저장한다. 꽉 찬 줄 뒤의 줄바꿈은 문단 안의 '접힘'으로 보고 이어 붙이되,
# 띄어쓸지 붙일지는 전체 문서의 어절 통계로 정한다: "분류된"이 한 어절로 더 자주 나오면 붙이고 "x y"가 더 자주 나오면 띄운다.
MARK = re.compile(r"^\s*(?:Q\s?\d*\s?[\.\):]|A\s?[\.:]|[-▶⇒❍☞※∙•·◦○●□■◆◇➊-➓①-⑳]|\d{1,2}[\.\)]\s|[가-하][\.\)]\s|\(\d+\)|<|\[|【|제\d+조|부\s*칙|참고|관련 조항)")
END = re.compile(r"(다|음|함|임|됨|요|까)[\.\?]?\s*$|[\.\?:]\s*$")


def _stats(docs):
    """한글 어절(문장부호 뺀 한글 덩어리) 빈도. 줄 첫·끝 어절은 잘린 조각일 수 있어 뺌"""
    from collections import Counter
    tok = Counter()
    for pages in docs.values():
        for p in pages:
            for line in p["text"].split("\n"):
                for w in line.split()[1:-1]:
                    tok.update(re.findall(r"[가-힣]+", w))
    return tok, None


def _sep(a, b, tok, _=None):
    """줄 a 끝과 줄 b 시작을 이을 때 넣을 문자: '' 또는 ' '"""
    x, y = a.split()[-1], b.split()[0]
    xc, yc = re.search(r"[가-힣]*$", x).group(), re.match(r"[가-힣]*", y).group()
    if not (xc and yc):  # 한글끼리 만나는 경계가 아님: 괄호 안쪽이면 붙이고 나머지는 띄움
        return "" if x.endswith(("(", "「", "『", "<", "/")) or y.startswith((")", ",", ".", "」", "』", ">", "/")) else " "
    joined, a_, b_ = tok[xc + yc], tok[xc], tok[yc]
    if a_ and b_ and joined < min(a_, b_):
        return " "  # 두 말이 각각 자주 쓰이고 붙인 꼴은 드묾 → 원래 띄어 쓴 자리
    return "" if joined or not (a_ and b_) else " "  # 붙인 꼴이 쓰이거나, 한쪽이 단독으로 안 쓰이는 조각


def dewrap(pages, tok, bi):
    lens = sorted(len(l) for p in pages for l in p["text"].split("\n") if l.strip())
    full = lens[int(len(lens) * 0.9)] * 0.8 if lens else 0  # 이보다 긴 줄은 폭이 꽉 차서 접힌 줄
    out = []
    for p in pages:
        lines, buf, prev = [l.rstrip() for l in p["text"].split("\n")], [], ""
        for l in lines:
            # 직전 '원래 줄'이 꽉 찼고, 이번 줄이 새 항목(번호·기호)으로 시작하지 않으면 이어 붙임
            if buf and l.strip() and prev.strip() and not MARK.match(l) and len(prev) >= full:
                sep = " " if END.search(prev) else _sep(prev, l.strip(), tok, bi)
                buf[-1] += sep + l.strip()
            else:
                buf.append(l)
            prev = l
        out.append({"page": p["page"], "text": "\n".join(buf)})
    return out


def load_pages():
    """data/text의 원문을 줄바꿈 복원해서 {파일 stem: pages}로 돌려줌 (사례 추출·빌드 공용)"""
    raw = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted(OUT.glob("*.json"))}
    tok, bi = _stats(raw)
    return {k: dewrap(v, tok, bi) for k, v in raw.items()}


def _check():
    from collections import Counter
    tok, bi = Counter({"분류된": 3, "지급한다": 2}), Counter()
    pages = [{"page": 1, "text": "아아아아아아아아아아 연구과제로 분\n류된 연구과제는\n- 다음 항목"}]
    assert dewrap(pages, tok, bi)[0]["text"] == "아아아아아아아아아아 연구과제로 분류된 연구과제는\n- 다음 항목", dewrap(pages, tok, bi)


if __name__ == "__main__":
    _check()
    OUT.mkdir(parents=True, exist_ok=True)
    for p in sorted(SRC.iterdir()):
        if p.suffix.lower() not in (".pdf", ".hwp", ".hwpx"):
            continue
        out = OUT / (p.stem + ".json")
        if out.exists() and out.stat().st_mtime > p.stat().st_mtime and "--force" not in sys.argv:
            continue
        pages = extract(p)
        assert pages and sum(len(x["text"]) for x in pages) > 500, f"추출 실패: {p.name}"
        out.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
        print(f"{p.name}: {len(pages)}쪽, {sum(len(x['text']) for x in pages):,}자")

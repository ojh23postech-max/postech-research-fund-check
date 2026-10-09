"""참고자료/ 원문(PDF·HWP·HWPX) → data/text/<문서>.json  [{page, text}]  (토큰 0)"""
import json, re, struct, sys, zipfile, zlib
from pathlib import Path

import olefile
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "참고자료", ROOT / "data" / "text"


def pdf_pages(p):
    with pdfplumber.open(p) as pdf:
        return [{"page": i + 1, "text": pg.extract_text() or ""} for i, pg in enumerate(pdf.pages)]


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


if __name__ == "__main__":
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

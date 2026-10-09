"""data/text/*.json → data/cases.json  (참고자료 Q&A·예시·판례를 사례로 추출, 키워드로 비목·판정 분류. LLM 미사용)

판정: 인정 / 불인정 / 판단필요. 답변 첫 문장을 우선 보고, 조건부 표현이 섞이면 판단필요.
case-curator 에이전트가 수정한 값은 data/case_overrides.json 에서 덮어쓴다.
"""
import hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT, OUT = ROOT / "data" / "text", ROOT / "data" / "cases.json"
OVERRIDES = ROOT / "data" / "case_overrides.json"

# 문서 파일명 일부 → 화면 표시명
DOCS = {
    "KEITI_환경기술": "KEITI 환경기술개발사업 연구개발비 Q&A 사례집(2025.12)",
    "농기평_2024": "농기평 연구비 FAQ 자료집(2024 하반기)",
    "QA사례집": "NRF 정부연구비 사용 Q&A 사례집(2026)",
    "국가연구개발혁신법 매뉴얼": "국가연구개발혁신법 매뉴얼(2026.7)",
    "학생인건비통합관리": "학생인건비 통합관리 매뉴얼(2026.7)",
    "기술료제도": "기술료제도 매뉴얼(2026)",
    "제재처분": "제재처분 가이드라인(2026)",
    "연구시설·장비비": "연구시설·장비비 통합관리 매뉴얼(2026)",
    "산업기술혁신사업": "산업기술혁신사업 공통 운영요령(고시 2024-218)",
    "여비집행지침": "POSTECH 여비집행지침(2026.3)",
    "여비규정": "POSTECH 여비규정(2026.5)",
    "연구비관리지침": "POSTECH 연구비관리지침(2026.1)",
    "계약규정": "POSTECH 계약규정(2026.8)",
    "연구업무규정시행세칙": "POSTECH 연구업무규정 시행세칙(2022.11)",
    "연구업무규정": "POSTECH 연구업무규정(2019.9)",
    "운영지침": "POSTECH 연구개발과제 운영지침(2026.9)",
}

# 비목 분류: 위에서부터 먼저 맞는 것 (세부 → 일반 순)
BIMOK = [
    ("학생인건비", r"학생인건비|학생연구자"),
    ("연구시설·장비비", r"장비|시설비|기자재|유지[･·]?보수"),
    ("연구재료비", r"재료비|시약|소모품|시작품|시제품"),
    ("연구활동비-여비", r"여비|출장|항공|숙박|체재비|일비"),
    ("연구활동비-회의비", r"회의비|회의|식대|다과|식비"),
    ("연구활동비-외부전문기술활용", r"외부\s?전문|전문가\s?활용|자문료|용역|분석료|시험[･·]?분석|외주"),
    ("연구활동비-기타", r"연구활동비|소프트웨어|도서|문헌|논문\s?게재|출판|학회|등록비|인쇄|사무용품|통신비|교육비|수수료|특허|지식재산"),
    ("연구수당", r"연구수당"),
    ("인건비", r"인건비|급여|계상률|참여연구자|연구근접지원인력|퇴직급여|4대\s?보험"),
    ("위탁·공동연구", r"위탁연구|공동연구|국제공동"),
    ("간접비", r"간접비|연구지원비|기관공통"),
    ("협약변경·과제관리", r"협약\s?변경|변경\s?협약|연구개발기관\s?변경|연구책임자\s?변경|과제\s?(중단|변경|이관)|연장"),
    ("정산·사용실적", r"정산|사용실적|잔액|이월|반납|이자"),
    ("기술료", r"기술료|기술실시"),
    ("제재처분", r"제재|참여제한|부가금|환수|부정행위"),
]

NEG = r"불가|수\s?없|하여서는\s?아니|해서는\s?안|안\s?됩니다|안됨|되지\s?않|하지\s?않|않습니다|않음|않는다|아닙니다|아님|위배됨|위배|제재처분\s?대상|금지|부적정"
POS = r"가능(?!한지|여부)|수\s?있|인정됩니다|인정됨|무방|그렇습니다|허용|해당됩니다|해당함|포함됩니다|포함됨"
COND = r"경우에\s?한하|협약\s?변경|승인\)?\s?하에|경우에\s?따라|다만|단,|사전\s?승인|승인을\s?받|협약에\s?따|전문기관.{0,15}(판단|협의|승인|결정)|중앙행정기관의\s?장이.{0,15}(인정|결정|정하)|사안별|검토\s?필요|종합적으로|개별적으로|여부에\s?따라"


def verdict(answer, kind):
    if kind == "판례" or kind == "위반유형":
        return "불인정", "제재·환수 사례"
    # 게시판 답변의 인사·머리말 줄은 건너뜀
    answer = re.sub(r"(?m)^.*(안녕하|담당자입니다|답변\s?드립니다|문의하신|질의하신|감사합니다|운영단입니다).*\n?", "", answer)
    # 첫 문장 = 앞의 "-", "▶" 떼고 첫 줄 또는 첫 마침표까지
    first = re.split(r"(?<=[다음함임됨])\.|\n", re.sub(r"^[-▶\s]+", "", answer.strip()), maxsplit=1)[0][:200]
    # "~하지 않아도 됨(가능)"류 이중부정은 인정으로
    if re.search(r"않아도\s?(됨|됩니다|무방)", first):
        return "인정", "않아도 됨"
    neg, pos, cond = (re.search(p, first) for p in (NEG, POS, COND))
    if cond or (neg and pos):
        return "판단필요", (cond or neg).group(0)
    if neg:
        return "불인정", neg.group(0)
    if pos:
        return "인정", pos.group(0)
    # 첫 문장에 신호가 없으면 답변 전체로 한 번 더, 그래도 없으면 판단필요
    whole = [k for k, p in (("불인정", NEG), ("인정", POS)) if re.search(p, answer[:600])]
    return (whole[0], "본문 기준") if len(whole) == 1 else ("판단필요", "답변 해석 필요")


# 사례가 어느 부처 과제에 해당하는지: 전문기관 이름 → 소관 부처 (2026 정부조직 기준)
ORG = [
    (r"한국연구재단|NRF", ["과학기술정보통신부", "교육부"]), (r"정보통신기획평가원|IITP", ["과학기술정보통신부"]),
    (r"산업기술기획평가원|KEIT|산업기술진흥원|KIAT|디자인진흥원|산업통상", ["산업통상부"]),
    (r"에너지기술평가원|KETEP|환경산업기술원|KEITI|기후에너지환경", ["기후에너지환경부"]),
    (r"중소기업기술정보진흥원|TIPA|중소벤처", ["중소벤처기업부"]), (r"보건산업진흥원|KHIDI|보건복지|의료기기연구개발사업단", ["보건복지부"]),
    (r"국토교통과학기술진흥원|KAIA|국토교통", ["국토교통부"]), (r"해양수산과학기술진흥원|KIMST|해양수산", ["해양수산부"]),
    (r"농림식품기술기획평가원|IPET|농림축산식품", ["농림축산식품부"]), (r"농촌진흥청", ["농촌진흥청"]),
    (r"기상산업기술원|기상청", ["기상청"]), (r"콘텐츠진흥원|문화체육관광", ["문화체육관광부"]), (r"국방기술|방위사업", ["방위사업청"]),
    (r"식품의약품", ["식품의약품안전처"]), (r"원자력안전", ["원자력안전위원회"]), (r"재난안전|행정안전", ["행정안전부"]),
    (r"임업진흥원|산림", ["산림청"]), (r"우주항공", ["우주항공청"]), (r"질병관리", ["질병관리청"]), (r"과학기술정보통신|과기정통", ["과학기술정보통신부"]),
]


def ministries(c):
    """공통(혁신법 매뉴얼 등) 또는 해당 부처 목록"""
    src = c["출처"]
    if c.get("출처구분") == "전문기관":
        return c["부처"]  # 수집 소스별로 지정
    if src.startswith("KEITI"):
        return ["기후에너지환경부"]
    if src.startswith("농기평"):
        return ["농림축산식품부"]
    if src.startswith("NRF") or c.get("출처구분") == "NRF":
        return ["과학기술정보통신부", "교육부"]  # 한국연구재단 사례 → 과기정통부·교육부 과제에만
    if "산업기술혁신사업" in src:
        return ["산업통상부"]
    org = c.get("전문기관") or ""
    for pat, ms in ORG:
        if org and re.search(pat, org):
            return ms
    return ["미상"] if c.get("출처") == "IRIS 연구수행문의" else ["공통"]


def cut(t, n=3000):
    """긴 답변은 n자 안의 마지막 문장 끝에서 자르고 원문 안내를 붙임"""
    if len(t) <= n:
        return t
    m = max(t.rfind(e, 0, n) for e in ("다.", "음.", "함.", "임.", "됨.", "\n"))
    return t[:m + 2 if m > n // 2 else n].rstrip() + "\n… (이하 생략, 원문 PDF 참고)"


def bimok(text):
    for name, pat in BIMOK:
        if re.search(pat, text):
            return name
    return "일반·제도"


def clean(s):
    s = re.sub(r"[·･･…]{3,}\s*\d*", "", s)
    s = re.sub(r"(?m)^\s*[/\\]?\d{1,3}[/\\]?\s*$", "", s)  # 쪽번호 줄
    s = re.sub(r"(?m)^(정부연구비 사용 Q&A 사례집|정부연구개발비 집행관리 Q&A|국가연구개발사업 제재처분 가이드라인)\s*$", "", s)
    s = re.sub(r"\d{0,3}\s*2024년 하반기 과제신청부터 정산까지 연구비 관련 FAQ 자료집|[ⅠⅡⅢⅣI]{1,4}\.?\s*[가-힣 ]{2,20}주요질의(?:\s*\d+\b)?", "", s)  # 농기평 머리글
    s = re.sub(r"한국환경산업기술원|환경기술개발사업 연구개발비 관리 및 Q&A 사례집|1\. 일반사항 2\. 비목별 연구개발비 계상·사용기준 및 Q&A", "", s)  # KEITI 머리글
    s = re.split(r"\s*\d{0,3}\s*(?:\n[^\n]{0,20})?불인정 사례\s+불인정 사(?:례|유)", s)[0]  # KEITI: 뒤따르는 '불인정 사례' 표는 답변이 아님
    return re.sub(r"\n{2,}", "\n", s).strip()


def dropcap(s):
    """농기평 자료집: 문단 첫 글자가 장식 글자라 '연 구비'처럼 한 칸 벌어져 추출됨 → 붙임"""
    s = re.sub(r"[ \t]+Q[ \t]+(?=[가-힣「‘“])", "\nQ ", s)  # 줄 가운데서 시작하는 다음 질문
    return re.sub(r"(?m)^(\s*(?:[QA]\s+)?)([가-힣]) (?=[가-힣])", r"\1\2", s)


Q_HEAD = re.compile(r"(?m)^\s*Q(?:\s?\d{0,3}\s?[\.\):]|\s+(?=[가-힣]))\s*")  # "Q1." "Q." "Q 질문"
# 'Q' 표시 없이 물음표로 끝나는 줄이 질문인 문서(KEITI 사례집)
QLINE_HEAD = re.compile(r"(?m)^(?![-▷※*·•\d\[(<])(?=[^\n]{6,160}\?\s*$)")
EX_HEAD = re.compile(r"(?m)^\s*(\(관련판례\d*\)|\[유형의 예시\]|\((?:[^()\n]{0,40})예시\)|<예시>|【예시】)")


def doc_name(stem):
    return next((v for k, v in DOCS.items() if k in stem), stem)


def blocks(pages, qline=False):
    """페이지 경계를 넘는 Q&A도 잡기 위해 전체를 이어붙이고 오프셋→쪽 매핑"""
    text, starts = "", []
    for p in pages:
        starts.append((len(text), p["page"]))
        text += p["text"] + "\n"
    page_at = lambda i: max((pg for s, pg in starts if s <= i), default=1)
    heads = sorted([(m.start(), m.end(), "Q&A") for m in (QLINE_HEAD if qline else Q_HEAD).finditer(text)] +
                   [(m.start(), m.end(), "예시") for m in EX_HEAD.finditer(text)])
    for n, (s, e, kind) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(text)
        yield kind, text[s:end], text[e:end], page_at(s)


def split_qa(body):
    body = re.sub(r"\?\s+A\s+(?=[가-힣「‘“(])", "?\nA ", body)  # 같은 줄에 붙은 "…요? A 답변"
    lines = [l.strip() for l in body.split("\n") if l.strip()]
    # 답변 시작: "A." / "-" / "▶" / "⇒" 로 시작하는 첫 줄
    for i, l in enumerate(lines):
        if i and re.match(r"^(A\s?[\.:]|A\s+(?=[가-힣])|[-▶⇒❍☞]|→)", l):
            return " ".join(lines[:i]), "\n".join(lines[i:])
    return lines[0] if lines else "", "\n".join(lines[1:])


def extract():
    out, seen = [], set()
    from extract import load_pages  # PDF 줄바꿈 복원본
    for stem, pages in load_pages().items():
        name = doc_name(stem)
        if stem.startswith("농기평"):
            pages = [{**p, "text": dropcap(p["text"])} for p in pages]
        for kind, raw, body, page in blocks(pages, qline=stem.startswith("KEITI")):
            if re.search(r"[·･･…]{5,}", raw[:300]):  # 목차 줄
                continue
            body = clean(body)
            if kind == "Q&A":
                q, a = split_qa(body)
                a = re.sub(r"^A(?:\s?[\.:]|\s+(?=[가-힣]))\s*", "", a)
            else:
                lines = body.split("\n")
                q, a = raw.strip().split("\n")[0][:60], "\n".join(lines[:10])
                kind = "판례" if "판례" in q else ("위반유형" if "유형의 예시" in q else "예시")
            q, a = q.strip(), a.strip()
            if len(q) < 6 or len(a) < 15:
                continue
            key = hashlib.md5((name + re.sub(r"\s", "", q)[:60]).encode()).hexdigest()[:10]  # 띄어쓰기 복원이 바뀌어도 id 유지
            if key in seen:
                continue
            seen.add(key)
            v, why = verdict(a, kind)
            out.append({
                "id": key, "출처구분": "참고자료", "출처": name, "쪽": page, "유형": kind,
                "제목": q[:160], "질의": q, "답변": cut(a),
                "비목": bimok(q + " " + a[:300]), "판정": v, "판정근거": why,
            })
    return out


def check():
    assert verdict("불가합니다. 연구개발비로 집행할 수 없습니다.", "Q&A")[0] == "불인정"
    assert verdict("가능합니다.", "Q&A")[0] == "인정"
    assert verdict("가능합니다. 다만 사전 승인을 받아야 합니다.", "Q&A")[0] == "인정"  # 첫 문장 기준
    assert verdict("전문기관의 승인을 받은 경우에 한하여 가능합니다.", "Q&A")[0] == "판단필요"
    assert verdict("정산하지 않아도 됩니다.", "Q&A")[0] == "인정"
    assert verdict("- 종전과 같이 3책5공이 적용되지 않음", "Q&A")[0] == "불인정"
    assert verdict("- 혁신법 시행령 제63조 제2항에 따라 제재부가금 또는 환수금의 분할납부가 가능", "Q&A")[0] == "인정"
    assert verdict("- 위탁의 주체는 주관연구개발기관이므로 공동연구개발기관은 위탁의 주체가 될 수 없으며", "Q&A")[0] == "불인정"
    assert bimok("학생연구자 인건비") == "학생인건비" and bimok("해외 출장 항공료") == "연구활동비-여비"


def rescrub(c):
    """게시판 글은 수집 당시 가림 기준이 지금보다 약했을 수 있어 매번 다시 가림(이름·연락처)"""
    from crawl_qna import scrub
    for k in ("제목", "질의", "답변"):
        if c.get(k):
            c[k] = scrub(c[k])


if __name__ == "__main__":
    check()
    cases = extract()
    # 게시판(IRIS/NRF) 수집분: 분류 기준이 바뀌어도 반영되도록 다시 판정
    board = ROOT / "data" / "board_cases.json"
    if board.exists():
        for c in json.loads(board.read_text(encoding="utf-8")):
            rescrub(c)
            c["판정"], c["판정근거"] = verdict(c["답변"], "Q&A")
            c["자동"] = True  # 사람 검수 전(키워드 분류) 표시 — overrides로 검수하면 해제
            c["비목"] = bimok(c["제목"] + " " + c.get("질의", "")[:300])
            cases.append(c)
    # 전문기관(IPET·SMTECH 등) Q&A·FAQ: 게시판과 같이 키워드 판정 후 '자동분류' 표시, 부처는 수집 소스 지정값
    agency = ROOT / "data" / "agency_cases.json"
    if agency.exists():
        for c in json.loads(agency.read_text(encoding="utf-8")):
            if not re.search(r"연구(?:개발)?비|사업비|집행|정산|인건비|협약|비목|계상|간접비|장비|재료|출장|회의|수당|위탁|이월|카드|부가세|환수|불인정", c["제목"] + c["질의"] + c["답변"][:300]):
                continue  # 회원가입·시스템 사용 안내 등 연구비와 무관한 글
            rescrub(c)
            c["판정"], c["판정근거"] = verdict(c["답변"], "Q&A")
            c["자동"] = True
            c["비목"] = bimok(c["제목"] + " " + c.get("질의", "")[:300])
            cases.append(c)
    if OVERRIDES.exists():  # case-curator 수정분이 최우선
        ov = json.loads(OVERRIDES.read_text(encoding="utf-8"))
        for c in cases:
            if c["id"] in ov:
                c.update(ov[c["id"]]); c.pop("자동", None)
    for c in cases:
        c["부처"] = ministries(c)
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    print(len(cases), "건", Counter(c["판정"] for c in cases), Counter(c["출처"] for c in cases).most_common())

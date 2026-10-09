"""1회성: 1차 수집분(공개글)에 '소관 전문기관'을 채우고 담당자 이름 가림을 다시 적용. 상세 화면이 '공개'가 아니면 제거."""
import json, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
import crawl_qna as cq

bc = ROOT / "data" / "board_cases.json"
cases = json.loads(bc.read_text(encoding="utf-8"))
cq.s.get(cq.BASE + cq.BOARDS["IRIS 연구수행문의"][0], timeout=30)
keep, dropped = [], 0
for c in cases:
    c["질의"], c["답변"] = cq.scrub(c.get("질의", "")), cq.scrub(c["답변"])
    if c["출처"] != "IRIS 연구수행문의" or c.get("전문기관"):
        keep.append(c); continue
    x = {"blbdId": "00000013", "blltSeq": c["게시번호"], "blltClSe": "PG1272"}
    try:
        q, a, date, field = cq.detail("IRIS 연구수행문의", x)
    except Exception as e:
        print("실패", c["게시번호"], e); keep.append(c); continue
    finally:
        time.sleep(cq.DELAY)
    if not a:  # 비공개로 확인되면 제거
        dropped += 1; continue
    c["전문기관"] = field.partition("|")[2]
    keep.append(c)
bc.write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
from collections import Counter
print("유지", len(keep), "제거", dropped, Counter(c.get("전문기관", "") for c in keep if c["출처"] == "IRIS 연구수행문의").most_common(15))

"""1회성: 1차 수집분에서 비공개(PG5001·PG5004) 게시글 제거. 목록만 다시 읽어 글번호별 공개 코드를 확인한다."""
import base64, json, time, sys
from pathlib import Path
import requests
ROOT = Path(__file__).resolve().parents[2]
s = requests.Session(); s.headers["User-Agent"] = "Mozilla/5.0 (compatible; POSTECH-research-fund-checker/1.0)"
s.get("https://www.iris.go.kr/contents/retrieveSmgAskRspdListView.do", timeout=30)
code, n, total = {}, 1, 1
while n <= total:
    r = s.post("https://www.iris.go.kr/contents/retrieveSmgAskRspdList.do", data={"pageIndex": n, "prgmId": "", "search": "search", "blbdId": "00000013"}, timeout=30)
    d = json.loads(base64.b64decode(r.text).decode()); total = d["paginationInfo"]["totalPageCount"]
    code.update({x["blltSeq"]: x["blltOpenRangSe"] for x in d["listAskRspd"]}); n += 1; time.sleep(1.5)
bc = ROOT / "data" / "board_cases.json"; st = ROOT / "data" / "board_state.json"
cases = json.loads(bc.read_text(encoding="utf-8"))
keep = [c for c in cases if c["출처"] != "IRIS 연구수행문의" or code.get(c["게시번호"]) == "PG5002"]
bc.write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
state = json.loads(st.read_text(encoding="utf-8"))
b = state.get("IRIS 연구수행문의", {}); b["pending"] = [x for x in b.get("pending", []) if code.get(x["blltSeq"]) == "PG5002"]
st.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
from collections import Counter
print("codes", Counter(code.values()), "| 수집", len(cases), "→ 유지", len(keep))

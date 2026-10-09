# POSTECH 연구비 집행 점검

국가R&D(혁신법)·산업부·POSTECH 규정으로 연구비 집행이 적정한지 판정합니다. 판정과 함께 참고자료·IRIS·NRF의 관련 사례(인정/불인정/판단필요)와 협약변경 필요 여부를 보여 줍니다.
사이트는 정적 파일(`docs/`)이며, 판정과 검색을 모두 브라우저에서 처리합니다. 사용자가 써도 **LLM 토큰이 들지 않습니다**.

## 구조
| 경로 | 내용 |
|---|---|
| `참고자료/` | 원문 PDF·HWP. `_수집/`은 법제처 API로 받은 전 부처 규정 원문입니다. 공개 저장소에서는 제외합니다. |
| `pipeline/extract.py` | 원문을 쪽 단위 텍스트로 바꿔 `data/text/`에 저장 |
| `pipeline/classify_cases.py` | 참고자료 Q&A·예시·판례와 게시판 글을 사례로 만들고 인정/불인정/판단필요로 분류. 분류 수정은 `data/case_overrides.json` |
| `pipeline/crawl_qna.py` | IRIS 연구수행문의·FAQ와 NRF 사업질의응답의 공개 답변글을 증분 수집. 이름·연락처는 저장하지 않음 |
| `pipeline/crawl_regs.py` | 법제처 Open API로 전 부처 R&D 규정 변경 점검. 결과는 `reports/날짜_규정변경.md` |
| `data/rules.json` | 판정 규칙(조건·협약변경·증빙·근거 조항/쪽) |
| `pipeline/build.py` | 규칙·사례·원문 발췌를 `docs/data.json`으로 묶고 검증 |
| `pipeline/test_scenarios.py` | 판정 시나리오 회귀 테스트 |
| `pipeline/run_biweekly.ps1` | 위 단계를 격주로 실행하고 변경이 있으면 push (Windows 작업 스케줄러 `POSTECH_연구비점검_격주갱신`, 격주 토 03:00) |
| `.claude/agents/` | 관리자용 에이전트: rule-extractor, case-curator, update-reviewer, site-builder, qa-verifier |

## 로컬 실행
```
python pipeline/build.py
python pipeline/test_scenarios.py
python -m http.server -d docs 8765   # http://localhost:8765
```

## 환경변수
- `LAW_OC`: 법제처 Open API 인증값. https://open.law.go.kr 에서 신청하며, 없으면 시험값 `test`를 씁니다.

## 수집 원칙
- IRIS `/contents/` 경로는 robots.txt에서 허용하므로 요청 간 1.5초 간격으로 수집합니다.
- NRF는 robots.txt가 전면 비허용입니다. 기관 결정에 따라 공개·답변완료 글만 요청 간 3초 간격으로 수집합니다. NRF가 차단하거나 중단을 요청하면 `--skip-nrf`로 끄세요.
- 사이트의 판정은 참고용입니다. 최종 판단은 연구지원팀과 전문기관 기준을 따릅니다.

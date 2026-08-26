# 교육정책 데일리 브리핑

교육부 공식 보도자료 + 국내 교육정책 뉴스 + 외신의 한국 교육 관련 보도를 매일 자동 수집해 한 화면에 보여주는 정적 사이트입니다.

## 자동화 흐름
1. 매일 06:30 KST GitHub Actions 실행
2. 교육부 보도자료 페이지 수집
3. Google News RSS 기반 국내/외신 검색
4. 중복 제거·주제 분류·중요도 정렬
5. `OPENAI_API_KEY`가 있으면 정책 브리핑/시사점 AI 요약
6. `docs/data/news.json`과 날짜별 archive 저장
7. 변경사항 자동 커밋 후 같은 작업에서 GitHub Pages까지 즉시 재배포

## 첫 배포
GitHub 저장소에 업로드한 뒤 **한 번만** Settings → Pages → Build and deployment → Source를 `GitHub Actions`로 설정합니다. 이후에는 매일 자동 갱신·재배포됩니다.

### AI 요약 사용
Repository Settings → Secrets and variables → Actions에:
- Secret: `OPENAI_API_KEY`
- Variable(선택): `OPENAI_MODEL` (기본값 `gpt-5-mini`)

AI 키가 없어도 수집/분류/원문 링크/자동 배포는 동작합니다.

## 갱신 시각 변경
`.github/workflows/update-news.yml`의 cron은 UTC 기준입니다. 현재 `30 21 * * *` = 한국시간 매일 06:30입니다.

## 주의
RSS/웹페이지 구조는 언론사나 기관이 변경할 수 있으므로, 장기 운영 시 실패 알림과 소스별 예외처리를 추가하는 것을 권장합니다.

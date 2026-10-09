# AURORA 현장 업무 포털

카드형 반응형 웹페이지입니다. 별도 설치나 외부 리소스 없이 `index.html`을 브라우저에서 열 수 있습니다.

연결된 메뉴: 식사 신청, 영수증 관리, 숙소 민원(Google Forms), 차량 운행·사고접수. 각 업무는 새 창으로 열립니다.
나머지 4개 메뉴는 준비중입니다.

로컬 확인: `python -m http.server 8000`
이전 3안 비교 화면은 `layouts.html`에 보관했습니다. 게시하지 않았습니다.

## 운영 배포

GitHub Pages용 워크플로는 `.github/workflows/pages.yml`입니다.
저장소 Settings → Pages → Source를 **GitHub Actions**로 선택하면 main 업데이트 시 자동 배포됩니다.
공개 배포에는 완성된 `index.html`만 포함되며 이전 시안은 포함하지 않습니다.

# AURORA 현장 업무 포털

기존 GitHub Pages에서 운영하는 정적 업무 포털입니다. 다른 메뉴·주소·디자인과 OneDrive 프로그램 링크는 유지합니다.

## 숙소 임차료 — CSV 다운로드와 프로그램 실행

추가 가입·결제 없이 기존 공개 GitHub 저장소의 표준 GitHub Actions와 Pages를 사용합니다. Firebase·Firestore는 연결하지 않습니다. 엑셀 업로드 인증은 무료 Apps Script 중계로 처리합니다.

- **STEP 01 (청록색):** 최신 CSV 다운로드.
- **STEP 02 (파란색):** 프로그램 다운로드 및 실행. 기존 OneDrive 공유 화면을 새 탭으로 열며, EAS 로그인·전표 작성은 Windows PC에서 진행합니다.

STEP 01 왼쪽에 최신 엑셀 원본 보관함을 추가합니다. 지정 계정은 서버 인증 후 업로드하고 다른 사용자는 다운로드합니다. 엑셀은 원본 보관용이며 기존 CSV를 자동 교체하지 않습니다. 무료 GitHub 저장과 무료 Apps Script 인증 중계를 사용합니다. 지정 계정의 서버 인증과 GitHub 원본 저장·다운로드를 검증했습니다. 배포·인증·검증 절차는 [server/README.md](server/README.md)를 참고하세요.

### 자동 검증과 기존 정상 파일 보호

`.github/workflows/pages.yml`은 기존 main 자동 배포 방식을 유지합니다. `scripts/prepare_rent.py`가 최신 CSV 등록 커밋을 찾고 다음을 검사한 후 공개 산출물을 준비합니다.

- 등록 한 번에 CSV 한 개, 최대 25MiB. 삭제·복수 파일·심볼릭 링크는 거부.
- UTF-8/BOM·CP949/EUC-KR, 정확한 14열·2줄 헤더, 최소 한 건, 중복 없는 양의 정수 순번, 올바른 인용부호·줄바꿈.
- 파일명·대상 월·Git 등록일·데이터 건수·인코딩·SHA-256 메타데이터를 자동 생성. 두 헤더는 건수에서 제외.
- 파일명·인코딩·BOM·줄바꿈·선행 0·날짜·금액과 원본 바이트를 보존. 다운로드 산출물 SHA-256 일치를 확인.

검증 또는 사이트 준비가 실패하면 Pages 배포 단계를 실행하지 않아 **기존 운영 사이트·CSV가 유지됩니다**. GitHub에 커밋한 잘못된 파일 자체를 자동 삭제하거나 되돌리지는 않습니다. 수정한 CSV 한 개를 다시 등록하면 됩니다. 한 번에 한 파일만 처리하므로 이전에 등록한 파일이 Git 기록에 있어도 최신 파일 한 개만 공개 다운로드 폴더에 복사합니다. 기존 원본도 Git 기록에서 보존됩니다.

미리보기는 기본 접힘이며 끝까지 텍스트로 렌더링합니다. HTML·스크립트는 실행하지 않습니다. PC는 열 줄바꿈, 모바일은 항목명/값 카드로 표시합니다. 헤더·미리보기 제목·항목명 고정을 유지합니다. 다운로드는 미리보기 파싱과 분리됩니다. 파일 URL은 기존 정책대로 공개이며 화면 잠금이 파일 접근을 통제하지 않습니다.

## 개발·검증

```sh
python3 -m unittest discover -s tests -v
python3 scripts/prepare_rent.py --output _site
python3 -m http.server 8000 --bind 127.0.0.1 --directory _site
```

`scripts/prepare_rent.py`는 커밋된 최신 CSV를 기준으로 사이트를 만듭니다. 실제 CSV 자료를 로그·예제·공유용 캡처에 포함하지 않습니다. 브라우저 테스트 `tests/github-browser.cjs`는 가상 CSV만 사용하며 로컬 검증 사이트에서 원본 대신 가상 응답을 주입합니다. 별도 Playwright 설치가 필요하면 기존 설치 경로를 `PLAYWRIGHT_MODULE`로 지정합니다.

배포는 main 푸시 시 기존 Pages workflow로 자동 진행됩니다. 공개 산출물은 `index.html`, `assets/`, `rent/`, `.nojekyll`이며 서버·테스트·개발 설정은 포함하지 않습니다. Firebase에 만들었던 계정·데이터베이스는 이 앱에서 호출하지 않으며 삭제나 요금제 변경도 자동으로 하지 않습니다.

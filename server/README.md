# 무료 GitHub 엑셀 보관함

파일은 기존 공개 GitHub 저장소의 `rent/workbooks/latest.xlsx`와 `latest.json`에 저장한다. Google Apps Script는 이름·비밀번호 확인과 GitHub API 호출만 수행한다. Google 버킷, 결제 계정, 유료 서버는 사용하지 않는다. Apps Script/GitHub 무료 사용량 한도는 적용된다. 파일은 공개되고 이전 버전은 Git 기록에 남는다.

사용자는 기존 페이지에서 접속하고 `.xlsx` 파일을 선택해 저장한다. `김성석` 계정의 비밀번호를 중계 서버가 검증한 경우에만 업로드 권한을 발급한다. 일반 사용자는 다운로드만 가능하다. 비밀번호나 GitHub 토큰은 브라우저 저장소에 보관하지 않는다. 업로드 세션만 탭에 보관하며 6시간 이내 만료된다. Google 캐시 조기 만료 시 다시 접속한다.

최대 파일 5MiB, 압축 해제 합계 20MiB. 원본 엑셀 보관만 수행하며 CSV로 자동 변환하지 않는다. CSV 다운로드·미리보기·기존 프로그램 링크는 유지한다. 파일과 메타데이터는 단일 Git 커밋으로 함께 저장한다. 동시 수정 시 강제 덮어쓰기를 하지 않으며 재시도한다. 사이트 배포 전에는 업로더에게 커밋으로 고정된 원본 다운로드를 제공하고, 다른 PC에는 Pages 배포 성공 후 반영한다. 다운로드는 크기와 SHA-256을 확인한다.

## 계정 소유자 인증 후 자동 배포

현재 환경의 플랫폼 Git 인증은 raw GitHub API 토큰을 제공하지 않는다. 중계 서버가 독립적으로 사용할 저장용 토큰과 Apps Script 소유자의 OAuth 승인이 필요하다. 채팅·소스·명령 인수에 토큰을 넣지 않는다.

안전한 환경 변수 바인딩:

- `GITHUB_UPLOAD_TOKEN`: **sskim4912/aurora_portal 하나만**, Contents 읽기/쓰기 권한. 조직·전체 저장소 관리자 토큰은 필요 없다.
- `APPS_SCRIPT_ACCESS_TOKEN`: 소유자 Google OAuth. `https://www.googleapis.com/auth/script.projects`, `https://www.googleapis.com/auth/script.deployments` 범위. 소유자 계정에서 Apps Script API 사용이 허용되어야 한다.

인증이 제공되면 작업자가 다음을 수행한다:

```sh
cd /workspace/aurora_portal
python3 scripts/deploy_upload.py
```

도구는 비공개 Apps Script 프로젝트 생성, 서버 코드·비밀 설정 업로드, 버전 생성, 공개 웹앱 배포, `rent/upload-config.json` URL 저장을 처리한다. GitHub 토큰은 최초 초기화 시 소유자 전용 Apps Script 프로젝트에 전달되며 공개 저장소에는 저장되지 않는다. 소유자 실행 승인 후 토큰을 편집기 코드에서 제거했고 현재는 비공개 Script Properties에서만 읽는다. 초기화 완료 상태의 재배포는 토큰을 코드에 다시 넣지 않는다. OAuth 토큰은 HTTP 인증에만 사용한다. 프로젝트·배포 ID는 체크아웃 밖 `/workspace/.cloud-setup/aurora-upload-deployment.json`에 보관한다. Apps Script API의 자동 배포가 소유자 정책에 의해 차단되면 이 단계는 계정 소유자의 Google 권한 설정이 필요하다.

`script.googleapis.com`, `script.google.com`, `script.googleusercontent.com`, `api.github.com`에 필요한 네트워크 접근을 허용해야 한다. 프록시 인증 바인딩을 사용할 경우 **비공개 서버 소스에 들어가는 GITHUB_UPLOAD_TOKEN이 script.googleapis.com 요청 본문에서도 실제 값으로 치환되는지 확인**해야 한다. 플레이스홀더를 Google에 저장한 상태로 완료 처리하지 않는다.

실제 서버 로그인, 가상 엑셀 업로드, 원본 재다운로드, SHA-256 일치, Pages 배포를 검증한 후 운영에 반영한다. 시험 파일을 운영 최신 파일로 남기지 않는다. `upload-config.json`의 endpoint가 비어 있으면 연결 미완료 상태이며, 저장 성공을 표시하지 않는다. 기존 다운로드는 유지된다.

## 로컬 검증

```sh
python3 -m unittest discover -s tests -v
node tests/upload-server.cjs
python3 scripts/prepare_rent.py --output _site
python3 -m http.server 8003 --bind 127.0.0.1 --directory _site
# 별도 터미널, RENT_TEST_UI_PASSWORD는 환경에서 제공
node tests/github-browser.cjs
node tests/workbook-browser.cjs
```

브라우저 테스트의 새 업로드 서버·파일 응답은 가상 응답이다. 실제 Google 배포나 GitHub 업로드 성공을 뜻하지 않는다. 서버 인증/원자적 커밋/재시도 테스트와 Pages 파일 검증은 별도로 실행한다. 공개 Pages 산출물에는 `server/`, `scripts/`, 인증 정보가 포함되지 않는다.

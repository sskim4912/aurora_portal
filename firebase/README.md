# Firebase 공용 CSV — accommodation-fee

현재 공개 웹앱 설정은 사용자 제공 값을 반영했습니다. GitHub Pages와 STEP 01(보라색 관리자 등록)·02(청록색 다운로드)·03(파란색 프로그램 실행)을 유지합니다. 실제 Firebase 서비스 활성화, 관리자 UID 등록, 함수/규칙 배포와 실서비스 검증은 아직 수행하지 않았습니다. 공개 firebaseConfig는 관리 권한이나 배포 인증이 아닙니다.

## 콘솔에서 필요한 설정

1. [Authentication](https://console.firebase.google.com/project/accommodation-fee/authentication/providers): 시작하기 → 이메일/비밀번호 제공업체 활성화. 사용자 탭에서 별도 관리자 계정을 만들고 UID를 확인합니다. 관리자 비밀번호는 웹 로그인 또는 콘솔에서만 입력하고 채팅·코드에 남기지 않습니다. 사용자 UID는 서버 허용 목록에만 등록합니다. 관리자 첫 로그인 시 이메일 인증을 안내하며, 인증된 이메일과 UID가 모두 일치해야 업로드할 수 있습니다. 일반 Firebase 가입 사용자는 허용하지 않습니다.
2. Authentication → 설정 → 승인된 도메인에 `sskim4912.github.io`를 추가합니다.
3. [Firestore](https://console.firebase.google.com/project/accommodation-fee/firestore): 데이터베이스 `(default)`를 프로덕션 모드로 생성합니다. 가능하면 서울 위치를 선택합니다. 기존 DB가 있으면 새로 만들거나 위치를 바꾸지 않습니다.
4. [Storage](https://console.firebase.google.com/project/accommodation-fee/storage): 기본 버킷 `accommodation-fee.firebasestorage.app`을 설정합니다. Functions 및 Storage는 결제 계정이 연결된 Blaze 요금제가 필요합니다. 요금제 변경과 과금 동의는 사용자가 콘솔에서 진행합니다. 예산 알림은 지출 상한이 아니므로 별도로 사용량을 확인합니다.

## 코드 및 권한

- Firebase Authentication ID 토큰을 서버 Admin SDK가 폐기 여부까지 검사합니다. 별도 화면 잠금 비밀번호를 Firebase/EAS에 전달하지 않습니다.
- `RENT_ADMIN_UIDS`는 쉼표로 구분한 관리자 UID 목록입니다. 배포 시 질문에 입력하거나, `functions/.env.accommodation-fee`에 지정합니다(ignored). 브라우저나 이메일만 비교하는 방식으로 권한을 부여하지 않습니다.
- 클라이언트의 직접 Storage·Firestore 접근은 거부합니다. 서버 서비스 계정의 IAM 권한만으로 처리합니다. 규칙 파일은 이 앱의 데이터만 정의합니다. 기존 다른 앱이 있는 프로젝트라면 기존 규칙을 읽고 병합한 후 배포해야 합니다. 확인 없이 기존 규칙 전체를 교체하지 않습니다.
- 서버는 CSV를 검증한 뒤 고유 경로의 비공개 Storage 객체에 원본 바이트를 저장합니다. 성공 후 Firestore의 최신 포인터 한 문서를 원자적으로 교체합니다. 실패한 저장은 기존 포인터를 바꾸지 않습니다. 포인터 갱신 실패 시 새 객체 삭제를 시도하고 기존 정상 파일을 유지합니다. 저장 무결성 검사는 CRC32C로 유지합니다.
- 원본 객체는 불변입니다. 교체 이전 버전은 당장 삭제하지 않아 진행 중 다운로드와 충돌하지 않습니다. 데이터 보관/정리 정책은 운영 연결 후 정해야 합니다. 객체는 브라우저에서 직접 읽을 수 없습니다.
- 메타데이터와 다운로드 API는 공개입니다. 원본 다운로드는 서버에서 그대로 전달하며 버전 불일치 요청은 409입니다. 앱 공개 CSV라는 기존 정책을 유지합니다.
- 관리자 토큰은 Firebase inMemoryPersistence만 사용합니다. 관리자 로그아웃은 클라이언트 인증 상태를 삭제합니다. Firebase ID 토큰은 표준 만료까지 유효할 수 있으며 관리자 강제 차단 시 UID 허용 목록 제거 또는 Admin SDK 토큰 폐기가 필요합니다. 새로고침 후 관리자 재인증이 필요하고 기존 화면 잠금 접속은 같은 탭에서 유지됩니다.

## 빌드와 배포 준비

Node.js 22:

```sh
npm ci
npm --prefix functions ci
npm run test:firebase
npm run build:firebase
```

`rent/vendor/firebase-client.js`는 npm Firebase SDK 번들입니다. Pages 워크플로는 변경하지 않고 이 파일을 기존 `rent/`와 함께 복사합니다. Functions 서버 번들은 `functions/lib/`에 생성됩니다.

배포는 **명시적인 배포 요청 후** 본인의 Firebase 권한을 가진 신뢰할 수 있는 터미널에서 수행합니다. 서비스 계정 키를 채팅이나 공개 저장소에 넣지 않습니다. Firebase CLI 로그인은 본인 브라우저 인증으로 진행합니다. Firebase 공개 설정만으로는 배포할 수 없습니다.

```sh
npx firebase-tools login
npx firebase-tools deploy --project accommodation-fee --only functions:rent-csv,firestore:rules,storage
```

배포 전 기존 규칙/IAM/활성 서비스 확인이 필요합니다. 이 명령은 준비 안내이며 이번 작업에서 실행하지 않았습니다. Firebase Hosting은 배포하지 않습니다. 함수 지역은 `asia-northeast3`, 함수 이름은 `rentCsvApi`입니다. 기본 실행 서비스 계정에 선택 버킷의 객체 읽기·쓰기와 Firestore 접근 권한이 있어야 합니다. 저장소나 IAM 권한을 공개로 바꾸지 않습니다.

최종 API 주소는 `https://asia-northeast3-accommodation-fee.cloudfunctions.net/rentCsvApi`입니다. 현재는 예정 주소이며 실제 배포/접속 성공을 의미하지 않습니다. 연결되지 않으면 기존 정적 CSV를 유지하고 서비스 미연결을 표시합니다. 기존 공용 CSV를 Firebase로 자동 업로드하지 않습니다.

## 검증 범위

`npm run test:firebase`는 가상 데이터로 서버 인증 거부/허용, CSV 인용부호·BOM·잘못된 순번·용량, 원본 바이트 보존, 저장 실패·포인터 실패·정상 교체를 검사합니다. UTF-8·CP949·EUC-KR 원본 보존도 검사합니다. 이는 실제 Firebase Auth/Storage/Firestore 통합 테스트를 대신하지 않습니다. `tests/firebase-fallback.cjs`는 실제 npm SDK를 로드하고 가상의 API 장애 상황에서 기존 원본 다운로드 유지·업로드 숨김·JavaScript 오류 없음을 검사합니다.

localhost에서는 기존 Python 가상 시연 API를 사용합니다([안내](../server/README.md)). 배포 전 실제 Firebase에서 관리자·일반 사용자, CP949/EUC-KR/UTF-8, 25MB 경계, 다른 기기 공유, CORS, 저장 장애와 원본 일치를 다시 검증해야 합니다. 이번 작업에서는 운영 배포·운영 공용 CSV 교체를 하지 않습니다.

# ewoo-clinical - 임상서식 시스템

## 프로젝트 개요
간호 라운딩, 바이탈 체크 등 임상 데이터를 기록하고 EMR과 연동하는 시스템.

## 기술 스택
- Next.js 14, React 18
- Firebase Firestore (ewoo-clinical 프로젝트) - 임상 데이터 저장
- Firebase Auth (ewoo-approval 프로젝트 공유) - 사용자 인증
- Firebase Admin SDK (서버용)
- MSSQL (`mssql@12`) - EMR DB 직접 연결 (커넥션 풀)
- Anthropic SDK (`@anthropic-ai/sdk`) - Claude API
- 배포: Vercel

## 관련 프로젝트
| 프로젝트 | 역할 | Firebase 프로젝트 |
|----------|------|-------------------|
| ewoo-hospital | 병동현황, 치료, 상담일지 | ewoo-hospital-ward |
| ewoo-approval | 전자결재, 경영현황 | ewoo-approval |
| ewoo-clinical | 임상서식 (간호라운딩, 바이탈) | ewoo-clinical (Firestore) |

- 인증은 ewoo-approval Firebase Auth를 공유 (로그인 1회로 양쪽 접근)
- 의과/간호과 부서만 접근 허용

## EMR 연동 아키텍처

### EMR DB 직접 연결
- 서버: 192.168.0.253:1433 (병원 내부망 SQL Server)
- DB: BrWonmu (브레인 닥터스 EMR)
- lib/emrPool.js: MSSQL 커넥션 풀 (max:5, idle:30s, timeout:60s)
- API 라우트(/api/emr/*)에서 서버사이드로 EMR 쿼리 실행

### 라즈베리파이와의 관계
- 이 프로젝트는 Vercel에 배포되므로 EMR DB에 직접 접근 불가 (내부망)
- Vercel 서버리스 함수에서 192.168.0.253에 연결하려면 병원 내부망 접근이 필요
- 라즈베리파이가 내부망에서 동작하며 EMR DB 접근 가능한 환경 제공
- 로컬 개발 시에는 병원 네트워크에서 직접 EMR DB 접근 가능

### 주요 EMR 테이블
- `Wbedm`: 병상 배치 (bedm_room 1~21 → 실제 호실 201~603 매핑)
- `VIEWJUBLIST`: 환자 마스터 뷰
- `SILVER_PATIENT_INFO`: 입원이력
- `Widis`/`Wdism`: 진단명
- `Widam`: 처방정보
- `Wnurse`: 바이탈(간호기록)

## Claude Code 제한사항

### Firebase DB 직접 확인 불가
- Claude Code는 Firebase(Firestore/Auth)에 인증할 수 없어 DB 데이터를 직접 조회/검증할 수 없음
- 임상서식 데이터, 사용자 권한 등을 직접 확인할 방법이 없음
- 개선 방향: 데이터 조회용 API 엔드포인트 추가 또는 CLI 스크립트 작성

### EMR DB 직접 확인 불가
- EMR DB는 병원 내부망에 있어 외부(Vercel/Claude Code)에서 접근 불가
- 테이블 구조나 데이터를 확인해야 할 때는 사용자에게 요청 필요

## 페이지 구성
- `pages/index.js` - 메인 (입원환자 수, 서식 카드)
- `pages/forms/doctor-rounding.js` - 의과 병동 라운딩 체크
- `pages/forms/medical-opinion.js` - 소견서 작성
- `pages/forms/nurse-rounding.js` - 간호 라운딩 서식
- `pages/forms/vital-check.js` - 바이탈 체크 서식

## API 엔드포인트
- `GET /api/emr/rounding-summary` - 병동 라운딩 요약 (Firestore → fallback EMR 프록시)
- `POST /api/emr/opinion-data` - 소견서용 EMR 상세 데이터 (EMR 프록시 경유)
- `GET /api/emr/patients` - 현재 입원환자 목록 (로컬 개발용, 내부망 직접)
- `POST /api/emr/patients` - 특정 환자 상세 (chartNo로 조회)
- `GET /api/emr/rounding` - 라운딩용 입원환자 목록 (병실순, 로컬 개발용)
- `POST /api/generate` - Claude API로 임상 데이터 생성/분석
- `GET /api/vitals` - 바이탈 데이터 조회

## Firebase 데이터 구조 (Firestore)
- Firestore를 사용하며 ewoo-hospital/ewoo-approval과 달리 Realtime DB가 아님

### 주요 Firestore 컬렉션
- `roundingSummary/{YYYY-MM-DD}` - 병동 라운딩 상세 데이터 (30분 주기 동기화)
  - `patients[]` - 환자 배열 (병동-병실 순)
    - `chartNo`, `name`, `dong`, `roomLabel`, `bed`, `admitDate`
    - `jumin` (주민번호 앞자리, 나이 계산용)
    - `attending` (주치의: '강국형' 또는 '이숙경')
    - `diagName` (주상병명 = 주소증)
    - `soapS` `{date, text}` (최근 SOAP S, 주치의 작성분만)
    - `workMemo` `{date, memo, author}` (최근 업무메모)
  - `lastSync` (ISO 타임스탬프), `count` (환자 수)
- `roundingSync/{YYYY-MM-DD}` - 간호 라운딩 환자 목록 (30분 주기 동기화)
  - `patients[]` - `chartNo`, `name`, `dong`, `room`, `bed`, `roomLabel`, `admitDate`, `memo`
- `roundingNotes/{YYYY-MM-DD}_{userId}` - 간호 라운딩 참고사항

### 동기화 스크립트 (라즈베리파이 cron)
- `scripts/syncRoundingSummary.js` - EMR → roundingSummary (매시 5,35분, 8-20시)
- `scripts/syncRounding.js` - EMR → roundingSync (매시 10,40분, 8-20시)

### 주치의 규칙
- 주치의는 **강국형**(가정의학과, dctrKey=2)과 **이숙경**(내과, dctrKey=5) 둘 뿐
- 김민준(병원장, dctrKey=1), 진영문(dctrKey=3)은 협진
- EMR `VIEWJUBLIST.dctrName`에서 주치의 판별
- SOAP S는 주치의 작성분만 표시 (`note_dctr IN (2, 5)`)

### 입원환자 필터 규칙
- `SILVER_PATIENT_INFO.INSUCLS` 기준: '50', '100' 제외 (ewoo-hospital과 동일)

## MCP 서버 연동 (.mcp.json)
- **firebase**: `firebase-tools --mcp` (ewoo-clinical Firestore 프로젝트)
- **github**: HTTP 방식 (`mcp.github.com`, OAuth 인증)
- **playwright**: `@anthropic-ai/mcp-server-playwright` (브라우저 자동화/테스트)
- **vercel**: HTTP 방식 (`mcp.vercel.com`, OAuth 인증)

## 인증
- ewoo-approval Firebase Auth 공유 (이름@ewoo.com)
- 부서 확인: approvalDb에서 users/{emailKey}/department 조회
- 의과/간호과만 접근 허용 (ALLOWED_DEPTS)

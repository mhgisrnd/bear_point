#forever 명령어(설치 후 사용)
npx forever start server.js

npx forever stop 0


#일반 시작
npm run dev

로컬 웹에서 팀 관리 API 연결
- `bear-admin`을 `http://localhost:9090`에서 실행한다.
- 이 앱의 `.env`에 `WEB_TEAMS_API_URL=http://localhost:9090/api/teams`를 지정한다.
- 환경 설정 변경 후 앱 개발 서버를 재시작한다.
- 이 설정은 웹 서버의 팀 조회에만 적용된다. 기존 실시간 개체 API와 APK의 서버 주소는 변경하지 않는다.
- 이 값을 지정하지 않으면 `REALTIME_API_BASE_*`로 선택한 서버의 `/api/teams`를 사용한다.

담당자·팀과 현장 등록
- 신규 관측점과 개체 추정위치는 설정된 담당자와 팀으로 등록한다. 변경은 오른쪽 상단 설정에서 한다.
- 등록할 때 `owner`, `team_id`, `team_name`, `team_color`를 복사해 저장하므로 설정 변경이 기존·미전송 자료를 바꾸지 않는다.
- 기존 관측점의 등록 담당자와 팀은 수정 시에도 유지한다. 팀이 없는 기존 자료에는 현재 팀을 임의 지정하지 않는다.
- SQLite v18은 두 기록 테이블에 팀 컬럼을 추가한다. 웹 개체 추정위치도 브라우저 저장소에 저장하여 새로고침 후 유지한다.
- 관측점 서버의 팀 컬럼은 `node scripts/migrate-observation-server.cjs`로 추가할 수 있다. 개체 전송은 기존 원본 payload에 팀 정보를 함께 보관한다.
- 팀별 지도 색상 표시는 후속 작업이다.

오프라인 행정경계망 표시
- 추후 적용을 위해 표시용 소스는 보관하지만, 현재 앱에서는 스크립트 로드·레이어 생성·메뉴 연결을 제외한다.
- 기존 `AdminBoundary.db`와 좌표 기반 행정구역명 자동 조회는 계속 사용한다.

GPS 이동 기록
- 설정 → 이동 기록에서 기록 간격(5/10/30/60초, 기본 10초)을 저장한다. 기록 간격은 진행 중인 기록에도 즉시 적용하고 기존 경로는 유지한다. 경로는 해당 팀 색상으로 표시하며 별도 색상 설정은 사용하지 않는다.
- 이동 기록 메뉴에서는 진행 중인 경로를 우선 표시한다. 관측점·개체 추적으로 전환하면 경로 레이어만 숨기고 기록은 계속한다.
- 이동 기록의 최소 이동 거리는 10m로 고정한다(기록 간격도 충족해야 함). Android는 `GpsTrackConfig.MIN_DISTANCE_METERS`, 웹은 `public/js/tracking/gps-track-store.js`의 `RECORDING_CONFIG.minDistanceMeters`에서 변경한다. GPS 정확도 허용치는 별도 `MAX_ACCURACY_METERS`/`maxAccuracyMeters`로 관리한다.
- 관측점 목록 옆 이동 기록 → 기록 시작으로 시작하고 종료·저장으로 종료한다. 담당자·팀·옵션은 시작 당시 값으로 보관한다.
- 기록 중에는 별도 지도 레이어에 경로와 시작/현재 지점을 표시하며, 종료 후 숨긴다. 기록 이력에서 다시 선택하면 시작/종료 지점, 시간, 거리를 확인할 수 있다.
- Android는 `GpsTrackingPlugin`과 위치 포그라운드 서비스로 기록한다. 위치·알림 권한과 GPS 활성화가 필요하다. 알림에는 경과 시간과 종료·저장 버튼을 표시한다. 알림을 차단하면 기록을 종료한다.
- Android 기록은 앱 내부 `GpsTracks.db`의 tracks/points 테이블에 매 지점마다 트랜잭션 저장한다. Capacitor의 기존 관측점 DB와 독립적으로 서비스에서 접근한다. 강제 종료 후에는 마지막 저장 지점까지의 기록을 중단 이력으로 복구한다.
- 웹은 IndexedDB에 저장하며 한 창에서만 기록할 수 있다. 화면 잠금/페이지 종료 이후의 지속 기록은 지원하지 않는다. 페이지 재진입 시 미종료 기록은 중단 이력으로 남긴다.
- GPS 오차 100m 초과, 오래된 위치, 간격 미달, 비정상적인 좌표 점프는 저장하지 않는다. 이동 거리는 GPS 기반 추정값이다.
- 종료된 기록은 관리자 서버로 자동 전송하며, 오프라인·전송 실패 시 기기 기록을 보존한다. 이동 기록의 `미전송 기록 전송`으로 재시도할 수 있다. 앱이 닫힌 동안에는 전송하지 않고 다음 실행 시 재시도한다.
- 관리자 `이동기록 조회`에서 담당자·팀·기간·상태 검색과 경로 상세 조회를 지원한다. 전송 UUID 중복은 서버에서 차단한다. 네이티브는 `MOVEMENT_API_URL`(미설정 시 realtimeApiBase 하위 `/movement-tracks`), 웹 게이트웨이는 `WEB_MOVEMENT_API_URL`로 수신 서버를 지정할 수 있다. 설정 변경 후 `npm run gen:runtime-config` 및 앱 자산 동기화·재빌드가 필요하다.
- 기록 시작/종료·저장과 새로고침은 헤더 오른쪽에 배치한다. 이력 표는 메뉴 진입 시 바로 조회한다.
- 담당자 부분 검색과 접이식 달력 필터(오늘/일별/월별/년별, 팀)를 함께 적용할 수 있다. 조회 기준은 기록 시작일의 한국 시간이며 기간 끝은 포함하지 않는다.
- 기간과 팀은 드롭다운 대신 선택 버튼으로 표시하며 클릭 즉시 조회한다. 일별·월별·년별을 선택했을 때만 날짜 입력을 표시한다. 별도 조건 조회 줄은 두지 않는다.
- 검색은 전체 이력을 대상으로 수행한 뒤 30건씩 표시한다. 팀 선택에는 현재 팀과 과거 기록에 남은 팀을 포함한다. 초기화로 모든 검색 조건을 해제한다.
- Android `GpsTracks.db` 버전 2는 기존 기록을 보존하고 조회 인덱스만 추가한다.
- GPS 지점이 0건인 세션은 종료·오류·중단 복구 시 `discarded`로 처리하고 이력·건수·팀 목록에서 제외한다. 이전 버전의 GPS 0건 이력도 조회에서 제외하며 실제 좌표가 있는 기록은 유지한다.
- 서버 전송도 GPS 지점이 1개 이상이고 메타데이터와 실제 지점 수가 일치하는 기록만 대상으로 한다. 전송 성공 후 로컬 이력을 삭제하지 않는다. 자동 확인에 대상이 없으면 완료 안내를 띄우지 않으며, 실패한 경우에만 미전송 재전송 버튼을 표시한다.
- 정지 중 최소 5m와 이전/현재 GPS 정확도 중 큰 값 이내의 변화는 저장하지 않는다. 이동이 확인되면 마지막 유효 지점부터 경로를 이어간다. 한 지점만 받은 기록은 거리 0km·기록 위치 하나로 표시한다.

모바일 지도 메뉴
- 태블릿 가로(900px 이상)를 제외한 화면에서는 하단 고정 메뉴 `관측점 / 개체 추적 / 이동 기록`을 사용한다.
- 한 패널에서 메뉴를 전환하며, 같은 메뉴 또는 패널 제목을 누르면 접고 펼친다. 목록은 패널 내부에서 스크롤한다.
- 최초에는 패널을 접어 지도를 넓게 표시한다. 메뉴를 전환해도 관측점 선택·필터 및 GPS 기록은 유지한다.
- 등록창을 열면 하단 패널을 잠시 접는다. 지도 조작 버튼과 상세 팝업은 하단 패널 높이를 반영해 배치한다.
- 태블릿 가로(900px 이상)에서는 같은 세 메뉴를 사이드바 상단에 배치하고, 목록·이동 기록을 사이드바 안에서 전환한다. 별도 관측점 목록 팝업은 열지 않는다.
- 모바일/태블릿이 같은 헤더·버튼·표·목록 스타일을 사용한다. 회전 시 선택한 메뉴와 데이터 상태는 유지하며, 태블릿 사이드바는 기존 접기 버튼으로 숨기고 펼친다.

웹앱 개발
HTML / CSS / JS
        ↓
Capacitor 설치(웹/앱 패키징을 위한 설치, 네이티브 기능 사용)
npm install @capacitor/core @capacitor/cli
        ↓
Capacitor 초기 설정
npx cap init
        ↓
capacitor.config.json 또는 capacitor.config.ts 생성됨
        ↓
Android 플랫폼 추가
npx cap add android
        ↓
android/ 폴더 생성됨
        ↓
웹 소스 변경 / 빌드
예: npm run build
        ↓
Android 쪽으로 동기화
npx cap sync android
        ↓
Android Studio에서 APK 빌드
npx cap open android


- 프로젝트 루트 cmd에서 실행 시, 

기기 목록 확인
npx cap run android --list

특정 기기/에뮬레이터 지정 실행
npx cap run android --target 기기ID


앱 배포
웹 변경 반영(프로젝트 루트에서 실행)
npx cap sync android
안드로이드 스튜디오 열기
npx cap open android

배포
cd android
.\gradlew.bat assembleDebug
생성된 APK 위치
android/app/build/outputs/apk/debug/app-debug.apk

안드로이드 AndroidManifest.xml 재빌드 필요 시
.\gradlew.bat assembleDebug --no-daemon


아이콘 추가/수정 시
npx capacitor-assets generate

sqllite 설치
npm view @capacitor-community/sqlite version; npm view @capacitor-community/sqlite peerDependencies --json
npm view @capacitor-community/sqlite@7 version; npm view @capacitor-community/sqlite@7.0.0 peerDependencies --json
npm install @capacitor-community/sqlite@7.0.3

SQLite 자산 DB 파일명 규칙
public/assets/databases/BearPointData.db (반드시 .db 확장자)
파일명과 dbName(BearPointData)은 확장자를 제외하고 일치해야 함
파일명 변경 후에는 반드시 아래 순서 실행
npx cap sync android
npx cap open android
Android Studio에서 Rebuild/재설치


배포본은 항상 overwrite false (sqllite-init.js) 유지 >> ASSET_DB_OVERWRITE : false
기존 사용자 DB는 덮어쓰지 않고 마이그레이션으로 올림
컬럼 추가/삭제 SQL 진행 뒤 변경할 곳
예시(sqllite-migrations.js)
window.BearSQLiteConfig = {
  dbName: "BearPointData",
  dbVersion: 2,
  assetDbOverwrite: false,
  migrations: {
    1: [],
    2: [
      "ALTER TABLE observations ADD COLUMN note TEXT",
      "CREATE TABLE IF NOT EXISTS detectors (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_observations_bear_code ON observations(bear_code)"
    ]
  }
};


앱 실행 시 마이그레이션이 돌고, 성공하면 user_version은 코드에서 갱신
npx cap sync android 후 빌드/배포


앱 sqlLite DB 확인 시
Android Studio에서 Device Explorer 열기
data/data/com.bearpoint.app/databases

26년 5월 06일
mbtiles는 용량이 크기 때문에  git에 x , 별도로 올릴 것!

경로 예시
mbtiles\korea-selection2-z7-z17-webp.mbtiles


PostgreSQL 실시간 목록 DB 연동
- .env에 PostgreSQL 값 설정
        - PG_HOST=172.30.6.100
        - PG_PORT=5432
        - PG_USER=postgres
        - PG_PASSWORD=postgres
        - PG_DATABASE=postgres
- 서버 실행
        - npm run dev
- 연결 확인
        - GET /api/db/postgres/health

생성 테이블
- bear_estimates_realtime
        - 컬럼: id, bear_estimate_id, bear_code, owner, place, lat, lng, lat_dms, lng_dms, intersections_count, source_observations (JSONB), analysis_options (JSONB), analysis_rays (JSONB), analysis_intersections (JSONB), source_created_at, uploaded_at, payload

관측점 공유 (SQLite v16)
- 관측점 검색의 접이식 필터에서 담당자와 오늘/일별/월별/년별 등록 기간을 조합합니다. 한국 시간의 최초 등록일(created_at)을 기준으로 하며, 이름·코드 검색과 함께 적용합니다. 필터를 접어도 조건 요약을 표시합니다. 초기화는 검색과 필터를 모두 해제합니다.
- 내 담당자는 이 기기의 마지막 등록 담당자명(bearpoint.lastRegisteredOwner)을 선택하는 기능입니다. 사용자 로그인이나 원래 등록자 ID에 의한 본인 식별은 아닙니다. 필터 변경으로 결과에서 제외된 항목은 선택을 해제하고 지도도 같은 결과로 갱신합니다.
- 앱/웹에서 관측점을 먼저 로컬에 보관한 뒤 서버 전송을 시도합니다. 실패 건은 목록의 전송/선택 전송 버튼으로 수동 재전송합니다.
- 상태: local(공유 필요), sending(전송 중), failed(실패), shared(공유 완료), conflict(충돌 확인). 공유 완료는 별도 표시하지 않고 미공유 관측점명만 빨간색으로 표시합니다. 관리 칸은 수정·삭제를 유지하며, 수동 공유는 체크박스로 선택한 뒤 상단의 선택 공유로만 진행합니다. 충돌은 관측점명 옆 작은 비교 버튼으로 확인합니다. 전송 중에는 수정·삭제할 수 없으며 충돌 건은 비교 후 삭제할 수 있습니다.
- 공유 이력이 있는 관측점의 삭제는 POST /api/observations/:id/removal로 server_version을 확인한 뒤 서버에 삭제 표시를 남깁니다. 서버 확인 후 기기 목록에서 숨기며, 통신 실패 시 자료를 유지합니다. 다른 사용자의 변경이 있으면 삭제를 중단하고 최신 내용을 확인하도록 합니다. 미공유 자료는 기기에서만 삭제합니다.
- 최초 등록 POST는 같은 ID를 덮어쓰지 않습니다. 이후 앱 수정은 POST /api/observations/:id/revisions에 수정 전 server_version과 mutation_id를 보내며, 버전이 맞을 때만 원자적으로 반영합니다. 응답 유실 후 동일 요청 재전송은 한 번만 반영합니다.
- 오프라인 수정은 기존 서버 버전을 유지한 채 기기에 보관합니다. 서버 버전 충돌 시 로컬 값을 덮어쓰지 않고 충돌 확인 화면에 양쪽 값을 표시합니다. 사용자가 내 수정본 반영 또는 서버 값 사용을 선택하며, 삭제된 서버 자료는 복구하지 않습니다.
- 관리자 화면: /admin/observations. 관리자 PATCH/DELETE API는 관리자 세션을 유지하며 server_version으로 동시 수정을 검사합니다. 앱의 버전 기반 수정 API는 기존 공개 등록 API와 같은 이용 범위이며, 사용자별 소유권 인증은 별도로 제공하지 않습니다.
- 공유 새로고침 시 관리자 변경/삭제를 로컬에 반영합니다. 미전송 로컬 수정은 서버 조회 결과로 덮어쓰지 않습니다.
- 응답 유실 후 로컬 수정과 이미 등록된 서버 내용이 다르면 충돌 확인으로 보냅니다. 사용자가 서버 값을 선택할 경우 기존 수정본을 unshared_backup에도 보관합니다.
- 서버 스키마 준비: node scripts/migrate-observation-server.cjs (.env 사용). API 최초 사용 시에도 동일한 비파괴 초기화를 수행합니다.
- API: GET/POST /api/observations, PATCH/DELETE /api/observations/:id. 목록에는 삭제 표시도 포함됩니다.
- 웹 관측점은 현재 접속한 서버의 api/observations를 사용합니다(컨텍스트 경로 유지). localhost 웹은 localhost API를 호출합니다. Android는 기존 realtimeApiBase의 /api/realtime을 /api/observations로 바꾼 원격 주소를 사용합니다. observationsApiBase를 명시하면 웹/앱 모두 해당 주소가 우선합니다.
- 검증: node --test tests/observation-sync.test.cjs scripts/test-admin-boundary.cjs
- PostgreSQL 검증: node scripts/test-observation-postgres.cjs (임시 테이블과 ROLLBACK만 사용).
- 코드 배포 후 서버를 재시작하고, Android는 npx cap sync android 후 APK를 다시 빌드합니다. 기존 관측점 DB는 덮어쓰지 않습니다.

실시간 업로드 API
- 개체 추적은 로컬/공유 전환 없이 하나의 목록과 지도로 표시합니다. 원본 추적 결과 ID로 중복을 합치며, 같은 개체의 서로 다른 추적 결과는 유지합니다.
- 개체 추적 제목과 목록 사이의 코드 검색은 대소문자 구분 없는 부분 검색을 지원합니다. 입력/조회/Enter로 적용하고 초기화하면 전체 목록으로 돌아갑니다. 검색 중 전체 선택·일괄 다운로드와 지도는 검색 결과만 대상으로 하며, 결과에서 빠진 항목의 선택은 해제합니다.
- 큰 가로 화면(900px 이상)에서는 개체 목록을 왼쪽 사이드바에 고정하고, 관측점 목록은 사이드바 오른쪽의 별도 팝업으로 엽니다. 관측점 목록이나 필터의 높이가 바뀌어도 개체 목록을 아래로 밀지 않습니다. 휴대폰은 기존 팝업 배치를 유지합니다.
- 사이드바 토글은 개체 목록만 접고 펼칩니다. 이미 열린 관측점 팝업은 현재 위치에 유지하며, 팝업의 닫기 버튼으로 별도 종료합니다.
- 관측점 목록 제목 줄은 마우스/터치 드래그로 이동할 수 있습니다. 버튼 조작은 드래그에서 제외하고, 화면 크기나 팝업 높이가 바뀌어도 화면 밖으로 벗어나지 않도록 위치를 보정합니다.
- 개체 목록은 큰 개체 번호와 등록자·위치·좌표(WGS84 위경도)의 3행 표로 표시합니다. TXT/XLS는 글자가 보이는 48×36px 버튼으로 제공하고 버튼 간 간격은 10px로 둡니다. 등록시각·도분초·TM 좌표는 상세 팝업에서 확인하며, 내보내기 데이터는 유지합니다.
- 공유 완료는 초록색 표시, 미공유는 빨간색 공유 버튼입니다. 선택 공유는 선택한 미공유 자료만 처리하고, 일부 전송 실패 시 성공 자료를 재전송하지 않습니다.
- 공유 목록은 처음 진입, 새로고침, 온라인 복귀 및 화면 표시 중 30초마다 갱신합니다. 미공유 자료의 재전송은 사용자 조작으로 진행합니다.
- SQLite v15의 bear_estimate_remote_cache에 서버 자료를 별도로 보관합니다. 웹은 localStorage를 사용합니다. 통신 실패 시 기존 목록을 유지하며, 전체 서버 목록을 확인한 경우에만 삭제된 자료를 반영합니다. 웹 샘플 자료는 통합 목록에서 제외합니다.
- 재전송 전 원본 ID의 기존 서버 등록 여부를 확인합니다. 서버 자체의 중복 삽입 방지는 원격 API의 별도 고유키/멱등 처리에 달려 있습니다.
- 검증: node --test tests/bear-estimate-store.test.cjs tests/bear-estimate-unified.test.cjs tests/realtime-gateway.test.cjs tests/realtime-download.test.cjs
- 웹 지도는 api/app-realtime 중계 경로를 사용해 설정된 원격 실시간 API를 호출합니다. Android는 기존 원격 주소를 직접 사용합니다. 관리자용 /api/realtime의 로컬 데이터 조회·수정 경로는 유지합니다.
- 저장: POST /api/realtime/bear-estimates
- 목록: GET /api/realtime/bear-estimates?limit=100


비밀번호 해시타입으로 선언 시 확인 api
http://localhost:3000/api/admin/auth/debug/hash?password=admin1234!

로그인 암호화 시, bcrypt 기반 단방향 salt 암호화 사용
admin/admin1234! > 관리자 세팅

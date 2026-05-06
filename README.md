#forever 명령어(설치 후 사용)
npx forever start server.js

npx forever stop 0


#일반 시작
npm run dev


앱 배포

웹 변경 반영(프로젝트 루트에서 실행)
npx cap sync android
npx cap open android

배포
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
mbtiles는 용량이 크기 때문에 별도로 올릴 것!

경로 예시
mbtiles\korea-selection2-z7-z17-webp.mbtiles
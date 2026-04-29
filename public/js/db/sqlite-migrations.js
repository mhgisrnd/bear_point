// public/js/db/sqlite-migrations.js
// SQLite 버전/마이그레이션 설정 전용 파일

(function initBearSQLiteConfig() {
  window.BearSQLiteConfig = {
    dbName: "BearPointData",
    dbVersion: 1,
    assetDbOverwrite: false,
    migrations: {
      1: []
    }
  };
})();
// public/js/db/sqlite-init.js
// Capacitor SQLite 초기화: 자산 DB 1회 복사 + 내부 DB 연결 열기

(function initBearSQLiteModule() {
  const config = window.BearSQLiteConfig || {};
  // DB 이름은 자산 파일명(BearPointData.db)의 확장자를 제외한 값과 맞춘다.
  const DB_NAME = String(config.dbName || "BearPointData");
  const DB_VERSION = Number.isFinite(Number(config.dbVersion)) ? Number(config.dbVersion) : 1;
  const ASSET_DB_OVERWRITE = !!config.assetDbOverwrite; // 기존 내부 DB 유지, true일 경우 덮어쓰니 주의.

  // 버전별 migration SQL을 순차 적용한다. 새 버전이 생기면 설정 파일에 번호를 추가한다.
  const MIGRATIONS = config.migrations && typeof config.migrations === "object"
    ? config.migrations
    : { 1: [] };

  const state = {
    initialized: false,
    ready: false,
    reason: "not-initialized",
    error: null,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    platform: null
  };

  function getCapacitor() {
    return window.Capacitor || null;
  }

  function getSQLitePlugin() {
    const capacitor = getCapacitor();
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.CapacitorSQLite || null;
  }

  function getPlatform() {
    const capacitor = getCapacitor();
    if (!capacitor || typeof capacitor.getPlatform !== "function") return "web";
    return capacitor.getPlatform();
  }

  function isNativePlatform() {
    const capacitor = getCapacitor();
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === "function") {
      return capacitor.isNativePlatform();
    }
    const platform = getPlatform();
    return platform === "android" || platform === "ios";
  }

  async function getCurrentDbVersion(sqlite) {
    try {
      const versionResult = await sqlite.getVersion({ database: DB_NAME, readonly: false });
      const version = Number(versionResult && versionResult.version);
      return Number.isFinite(version) ? version : 0;
    } catch (error) {
      console.warn("[SQLite] getVersion failed, treating as version 0:", error);
      return 0;
    }
  }

  async function runMigrations(sqlite, currentVersion) {
    if (currentVersion >= DB_VERSION) {
      return currentVersion;
    }

    for (let nextVersion = currentVersion + 1; nextVersion <= DB_VERSION; nextVersion += 1) {
      const statements = MIGRATIONS[nextVersion];
      if (!Array.isArray(statements)) {
        throw new Error(`[SQLite] Missing migration definition for version ${nextVersion}`);
      }

      if (statements.length === 0) {
        continue;
      }

      await sqlite.execute({
        database: DB_NAME,
        statements: statements.join(";\n"),
        transaction: true,
        readonly: false
      });

      await sqlite.execute({
        database: DB_NAME,
        statements: `PRAGMA user_version = ${nextVersion}`,
        transaction: false,
        readonly: false
      });
    }

    return await getCurrentDbVersion(sqlite);
  }

  async function initialize() {
    // 앱 생명주기 동안 1회만 초기화하고 이후에는 캐시된 상태를 반환한다.
    if (state.initialized) return { ...state };

    state.platform = getPlatform();

    if (!isNativePlatform()) {
      // 웹 개발 서버에서는 native sqlite를 사용할 수 없으므로 조용히 종료한다.
      state.initialized = true;
      state.ready = false;
      state.reason = "non-native-platform";
      return { ...state };
    }

    const sqlite = getSQLitePlugin();
    if (!sqlite) {
      // 플러그인이 아직 로드되지 않은 경우 앱 UI는 계속 동작하도록 실패를 격리한다.
      state.initialized = true;
      state.ready = false;
      state.reason = "sqlite-plugin-not-found";
      return { ...state };
    }

    try {
      // assets/databases/*.db 파일이 있다면 최초 1회 내부 저장소로 복사된다.
      await sqlite.copyFromAssets({ overwrite: ASSET_DB_OVERWRITE });
    } catch (copyError) {
      // DB 파일이 아직 없는 단계에서는 복사 실패를 치명 오류로 보지 않는다.
      console.warn("[SQLite] copyFromAssets skipped:", copyError);
    }

    try {
      const dbExistsResult = await sqlite.isDBExists({ database: DB_NAME, readonly: false });
      const dbExists = !!(dbExistsResult && dbExistsResult.result);

      if (!dbExists) {
        // 자산 DB를 아직 배치하지 않은 단계에서는 연결을 열지 않고 대기 상태로 둔다.
        state.initialized = true;
        state.ready = false;
        state.reason = "db-not-found";
        return { ...state };
      }

      try {
        // 이미 열린 연결이 있을 수 있으므로 createConnection은 중복 오류를 허용한다.
        await sqlite.createConnection({
          database: DB_NAME,
          version: DB_VERSION,
          encrypted: false,
          mode: "no-encryption",
          readonly: false
        });
      } catch (connectionError) {
        const message = String(connectionError && connectionError.message ? connectionError.message : connectionError);
        if (!/already exists|Connection .* already exists/i.test(message)) {
          throw connectionError;
        }
      }

      // 내부 저장소 DB를 실제 읽기/쓰기 모드로 연다.
      await sqlite.open({ database: DB_NAME, readonly: false });

      const currentVersion = await getCurrentDbVersion(sqlite);
      const migratedVersion = await runMigrations(sqlite, currentVersion);
      if (migratedVersion !== currentVersion) {
        console.info(`[SQLite] migration applied: v${currentVersion} -> v${migratedVersion}`);
      }

      state.initialized = true;
      state.ready = true;
      state.reason = "ok";
      state.error = null;
      return { ...state };
    } catch (error) {
      state.initialized = true;
      state.ready = false;
      state.reason = "init-failed";
      state.error = error && error.message ? error.message : String(error);
      console.error("[SQLite] initialization failed:", error);
      return { ...state };
    }
  }

  function getState() {
    return { ...state };
  }

  window.BearSQLite = {
    initialize,
    getState
  };
})();

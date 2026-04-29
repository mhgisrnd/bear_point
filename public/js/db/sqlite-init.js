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

  // 마이그레이션 이력과 실제 스키마가 어긋난 경우를 대비한 보정 규칙.
  // 규칙은 sqlite-migrations.js에서 선언만 추가하면 된다.
  const SCHEMA_GUARDS = Array.isArray(config.schemaGuards) ? config.schemaGuards : [];

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

      if (statements.length > 0) {
        await sqlite.execute({
          database: DB_NAME,
          statements: statements.join(";\n"),
          transaction: true,
          readonly: false
        });
      }

      await sqlite.execute({
        database: DB_NAME,
        statements: `PRAGMA user_version = ${nextVersion}`,
        transaction: false,
        readonly: false
      });
    }

    return await getCurrentDbVersion(sqlite);
  }

  // 선언형 schema guard를 적용해 스키마 누락을 자동 보정한다.
  async function applySchemaGuards(sqlite) {
    if (SCHEMA_GUARDS.length === 0) return;

    for (let i = 0; i < SCHEMA_GUARDS.length; i += 1) {
      const guard = SCHEMA_GUARDS[i] || {};
      const type = String(guard.type || "").trim();
      const apply = String(guard.apply || "").trim();

      if (!apply) {
        continue;
      }

      const supported =
        type === "column-exists" ||
        type === "table-exists" ||
        type === "index-exists";
      if (!supported) continue;

      try {
        await sqlite.execute({
          database: DB_NAME,
          statements: apply,
          transaction: false,
          readonly: false
        });
        console.info("[SQLite] schema guard applied:", apply);
      } catch (guardError) {
        const message = String(guardError && guardError.message ? guardError.message : guardError);
        // 이미 컬럼이 존재하는 경우는 정상으로 간주한다.
        if (/duplicate column name|already exists|duplicate/i.test(message)) {
          console.info("[SQLite] schema guard skipped (already applied):", apply);
          continue;
        }
        throw guardError;
      }
    }
  }

  async function initialize() {
    // 성공 상태는 캐시하지만, 실패 상태(init-failed 등)는 재시도를 허용한다.
    if (state.initialized && state.ready) return { ...state };
    if (state.initialized && state.reason === "non-native-platform") return { ...state };

    state.platform = getPlatform();
    state.error = null;

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
      let dbExists = true;
      try {
        const dbExistsResult = await sqlite.isDBExists({ database: DB_NAME, readonly: false });
        dbExists = !!(dbExistsResult && dbExistsResult.result);
      } catch (existsError) {
        const existsMessage = String(existsError && existsError.message ? existsError.message : existsError);
        if (/No available connection for database/i.test(existsMessage)) {
          // 일부 단말/버전 조합에서는 isDBExists가 연결 생성 전 호출 시 예외를 던진다.
          // 이 경우 createConnection/open 단계로 진행해 실제 연결 가능 여부를 판단한다.
          console.warn("[SQLite] isDBExists pre-check skipped:", existsMessage);
          dbExists = true;
        } else {
          throw existsError;
        }
      }

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
      try {
        await sqlite.open({ database: DB_NAME, readonly: false });
      } catch (openError) {
        const openMessage = String(openError && openError.message ? openError.message : openError);
        if (!/already open|already opened|database .* is already open/i.test(openMessage)) {
          throw openError;
        }
      }

      const currentVersion = await getCurrentDbVersion(sqlite);
      const migratedVersion = await runMigrations(sqlite, currentVersion);
      if (migratedVersion !== currentVersion) {
        console.info(`[SQLite] migration applied: v${currentVersion} -> v${migratedVersion}`);
      }

      await applySchemaGuards(sqlite);

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

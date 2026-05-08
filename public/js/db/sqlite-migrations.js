// public/js/db/sqlite-migrations.js
// SQLite 버전/마이그레이션 설정 전용 파일

(function initBearSQLiteConfig() {
  window.BearSQLiteConfig = {
    dbName: "BearPointData",
    dbVersion: 8,
    assetDbOverwrite: false,
    // 마이그레이션 이력과 실제 컬럼 상태가 어긋난 DB를 위한 보정 규칙.
    // 새 누락 컬럼이 생기면 여기에 규칙만 추가하면 된다.
    schemaGuards: [
      {
        type: "column-exists",
        table: "observations",
        column: "place",
        apply: "ALTER TABLE observations ADD COLUMN place TEXT"
      },
      {
        type: "column-exists",
        table: "bears",
        column: "bear_code",
        apply: "ALTER TABLE bears ADD COLUMN bear_code TEXT"
      },
      {
        type: "column-exists",
        table: "observations",
        column: "detectors_json",
        apply: "ALTER TABLE observations ADD COLUMN detectors_json TEXT"
      },
      {
        type: "table-exists",
        table: "detector_catalog",
        apply: "CREATE TABLE IF NOT EXISTS detector_catalog (detector_name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT NOT NULL DEFAULT (datetime('now')))"
      },
      {
        type: "index-exists",
        table: "detector_catalog",
        column: "last_used_at",
        apply: "CREATE INDEX IF NOT EXISTS idx_detector_catalog_last_used_at ON detector_catalog(last_used_at DESC)"
      },
      {
        type: "table-exists",
        table: "bear_estimates",
        apply: "CREATE TABLE IF NOT EXISTS bear_estimates (id TEXT PRIMARY KEY, bear_code TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, lat_dms TEXT, lng_dms TEXT, intersections_count INTEGER, source_observation_ids TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
      },
      {
        type: "index-exists",
        table: "bear_estimates",
        column: "created_at",
        apply: "CREATE INDEX IF NOT EXISTS idx_bear_estimates_created_at ON bear_estimates(created_at DESC)"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "lat_dms",
        apply: "ALTER TABLE bear_estimates ADD COLUMN lat_dms TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "lng_dms",
        apply: "ALTER TABLE bear_estimates ADD COLUMN lng_dms TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "source_observations_json",
        apply: "ALTER TABLE bear_estimates ADD COLUMN source_observations_json TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "analysis_rays_json",
        apply: "ALTER TABLE bear_estimates ADD COLUMN analysis_rays_json TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "intersections_json",
        apply: "ALTER TABLE bear_estimates ADD COLUMN intersections_json TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "analysis_options_json",
        apply: "ALTER TABLE bear_estimates ADD COLUMN analysis_options_json TEXT"
      },
      {
        type: "column-exists",
        table: "bear_estimates",
        column: "analysis_diagnostics_json",
        apply: "ALTER TABLE bear_estimates ADD COLUMN analysis_diagnostics_json TEXT"
      }
    ],
    migrations: {
      1: [],
      2: [
        "ALTER TABLE observations ADD COLUMN place TEXT",
        "CREATE TABLE IF NOT EXISTS observation_detectors (id INTEGER PRIMARY KEY AUTOINCREMENT, observation_id TEXT NOT NULL, detector_name TEXT, signal_strength TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE)",
        "CREATE INDEX IF NOT EXISTS idx_observation_detectors_observation_id ON observation_detectors(observation_id)"
      ],
      3: [
        "ALTER TABLE bears ADD COLUMN bear_code TEXT",
        "UPDATE bears SET bear_code = id WHERE bear_code IS NULL OR bear_code = ''"
      ],
      4: [
        "CREATE TABLE IF NOT EXISTS detector_catalog (detector_name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE INDEX IF NOT EXISTS idx_detector_catalog_last_used_at ON detector_catalog(last_used_at DESC)"
      ],
      5: [
        "ALTER TABLE observations ADD COLUMN detectors_json TEXT"
      ],
      6: [
        "CREATE TABLE IF NOT EXISTS observations_v6 (id TEXT PRIMARY KEY, bear_code TEXT NOT NULL, owner TEXT, lat REAL NOT NULL, lng REAL NOT NULL, heading REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, place TEXT, detectors_json TEXT)",
        "INSERT INTO observations_v6 (id, bear_code, owner, lat, lng, heading, created_at, updated_at, place, detectors_json) SELECT id, bear_code, owner, lat, lng, heading, created_at, updated_at, place, detectors_json FROM observations",
        "DROP TABLE observations",
        "ALTER TABLE observations_v6 RENAME TO observations",
        "CREATE INDEX IF NOT EXISTS idx_observations_bear_code ON observations(bear_code)",
        "CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at)"
      ],
      7: [
        "CREATE TABLE IF NOT EXISTS bear_estimates (id TEXT PRIMARY KEY, bear_code TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, lat_dms TEXT, lng_dms TEXT, intersections_count INTEGER, source_observation_ids TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE INDEX IF NOT EXISTS idx_bear_estimates_created_at ON bear_estimates(created_at DESC)"
      ],
      8: [
        "ALTER TABLE bear_estimates ADD COLUMN source_observations_json TEXT",
        "ALTER TABLE bear_estimates ADD COLUMN analysis_rays_json TEXT",
        "ALTER TABLE bear_estimates ADD COLUMN intersections_json TEXT",
        "ALTER TABLE bear_estimates ADD COLUMN analysis_options_json TEXT",
        "ALTER TABLE bear_estimates ADD COLUMN analysis_diagnostics_json TEXT"
      ]

    }
  };
})();
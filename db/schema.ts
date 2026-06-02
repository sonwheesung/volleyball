// 로컬 저장 (CLAUDE.md 8장) — 구조적 데이터는 expo-sqlite.
// MVP는 로컬 우선. Supabase는 이후 옵션.
//
// TODO(Phase 3): expo-sqlite 연결 + 마이그레이션 + 쿼리.

export const SCHEMA_VERSION = 1;

/** 초기 테이블 DDL. openDatabaseSync 후 execSync 로 적용. */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     age INTEGER NOT NULL,
     position TEXT NOT NULL,
     isForeign INTEGER NOT NULL,
     data TEXT NOT NULL          -- 나머지 스탯은 JSON 직렬화
   );`,
  `CREATE TABLE IF NOT EXISTS teams (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     coachStyle TEXT NOT NULL,
     foreignSlots INTEGER NOT NULL,
     data TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS seasons (
     season INTEGER PRIMARY KEY NOT NULL,
     data TEXT NOT NULL          -- 순위·통계·아카이브
   );`,
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
];

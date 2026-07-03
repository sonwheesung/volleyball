// 진단 스냅샷 생성기 (BACKEND_SYSTEM §8·§13.6, #45 코어) — 문의 제출 시 최근 N시즌의 **비저장(재계산) 데이터**를
// 모아 티켓에 첨부(대부분 문의가 히스토리 오류라 분석에 핵심). 순수 함수(시드 결정론) — PG 무관, tsx로 검증.
//
// 범위: `[max(0, season-10) .. season]`(0-based) — 사용자 예시(15시즌→5~15시즌·5시즌→1~5시즌, 1-based)와 일치.
// 게임 기록을 새로 저장하지 않고, 이미 재계산 가능한 소스(archive·milestones·retirements·hof·뉴스 재생·선수 seasonLines)를
// 범위로 잘라 담는다. 업로드는 lib/server.ts(무거우니 문의 제출 후 백그라운드). "now"는 호출부(앱 런타임)가 주입.
import type { SeasonArchive, Milestone, RetireRecord, HofEntry, Player, NewsItem } from '../types';
import type { DiagLogEntry } from '../lib/deviceLog';
import { buildNewsFeed } from './news';
import { leagueDisplayDay } from './standings';

export const SNAPSHOT_SPAN = 10; // 현재 포함 최근 (SNAPSHOT_SPAN+1)시즌 — 사용자 정의(15→5..15)

export interface SnapshotInput {
  season: number; // 현재 시즌(0-based)
  currentDay: number;
  myTeamId: string;
  engineVersion: number;
  archive: SeasonArchive[];
  milestones: Milestone[];
  hallOfFame: HofEntry[];
  retirements: RetireRecord[];
  released: string[];
  players: Player[]; // 현재 playerBase 값들
  logs: DiagLogEntry[]; // deviceLog 버퍼(범위 내)
  now: number; // Date.now() — 호출부 주입(순수성 유지)
  // 전지훈련(다이아 유일 소비처) 진단(§13.17) — "차감됐으나 미적용" 케이스 추적용. 선택(구 호출부 호환)
  diamonds?: number; // 다이아 캐시 잔액(표시)
  campLog?: Array<{ season: number; playerId: string; course?: string; stats?: string[] }>; // 적용된 전지훈련 내역
  pendingCamp?: { key: string; playerId: string; course: string; season: number } | null; // 미정산 아웃박스(차감↔적용 사이 흔적)
}

export interface SnapshotSeason {
  season: number;
  archive: SeasonArchive | null;
  news: NewsItem[];
  milestones: Milestone[];
  retirements: RetireRecord[];
  hofInducted: Array<Pick<HofEntry, 'id' | 'name' | 'position' | 'teamId' | 'points' | 'legend'>>;
}

export interface SnapshotPlayer {
  id: string;
  name: string;
  position: string;
  teamId: string | null;
  age: number;
  isForeign: boolean;
  seasonLinesInRange: NonNullable<Player['seasonLines']>;
}

export interface DiagnosticSnapshot {
  meta: {
    generatedAt: number;
    engineVersion: number;
    myTeamId: string;
    currentSeason: number; // 0-based
    fromSeason: number; // 0-based, inclusive
    toSeason: number; // 0-based, inclusive
    note: string;
  };
  seasons: SnapshotSeason[];
  players: SnapshotPlayer[];
  releasedNow: string[];
  logs: DiagLogEntry[];
  // 전지훈련·다이아 진단(§13.17) — 서버 wallet_ledger(권위)와 대조해 "차감됐으나 미적용" 판별
  wallet: {
    diamonds: number | null;
    campLog: Array<{ season: number; playerId: string; course?: string; stats?: string[] }>;
    pendingCamp: { key: string; playerId: string; course: string; season: number } | null;
  };
}

/** 순수 — 입력 상태를 최근 범위로 잘라 진단 스냅샷 JSON을 만든다. 같은 입력 → 같은 출력(결정론). */
export function buildDiagnosticSnapshot(input: SnapshotInput): DiagnosticSnapshot {
  const cur = input.season;
  const from = Math.max(0, cur - SNAPSHOT_SPAN);
  const inRange = (s: number) => s >= from && s <= cur;

  // 뉴스 재생 — 컷오프는 leagueDisplayDay(현재 경기일−1, 미관전 스포일러 제외). 전체 생성 후 범위로 필터.
  const allNews = buildNewsFeed(
    input.archive,
    input.milestones,
    input.hallOfFame,
    cur,
    [],
    [],
    leagueDisplayDay(input.currentDay),
    input.myTeamId,
    [],
    input.retirements,
  );

  const seasons: SnapshotSeason[] = [];
  for (let s = from; s <= cur; s++) {
    seasons.push({
      season: s,
      archive: input.archive.find((a) => a.season === s) ?? null,
      news: allNews.filter((n) => n.season === s),
      milestones: input.milestones.filter((m) => m.season === s),
      retirements: input.retirements.filter((r) => r.season === s),
      hofInducted: input.hallOfFame
        .filter((h) => h.retiredSeason === s)
        .map((h) => ({ id: h.id, name: h.name, position: h.position, teamId: h.teamId, points: h.points, legend: h.legend })),
    });
  }

  // 선수 — 범위 내 활동(seasonLines가 범위에 걸치는) 선수만. seasonLines도 범위로 자른다.
  const players: SnapshotPlayer[] = [];
  for (const p of input.players) {
    const lines = (p.seasonLines ?? []).filter((l) => inRange(l.season));
    if (lines.length === 0) continue;
    players.push({
      id: p.id,
      name: p.name,
      position: p.position,
      teamId: lines.length ? lines[lines.length - 1].teamId : null,
      age: p.age,
      isForeign: !!p.isForeign,
      seasonLinesInRange: lines,
    });
  }

  return {
    meta: {
      generatedAt: input.now,
      engineVersion: input.engineVersion,
      myTeamId: input.myTeamId,
      currentSeason: cur,
      fromSeason: from,
      toSeason: cur,
      note: `최근 ${cur - from + 1}시즌(0-based ${from}..${cur}) 재계산 스냅샷 — 비저장 히스토리 진단용`,
    },
    seasons,
    players,
    releasedNow: input.released,
    logs: input.logs.filter((e) => inRange(e.season)),
    wallet: {
      diamonds: input.diamonds ?? null,
      campLog: (input.campLog ?? []).filter((e) => inRange(e.season)),
      pendingCamp: input.pendingCamp ?? null,
    },
  };
}

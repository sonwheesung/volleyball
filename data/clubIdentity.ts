// 구단 정체성(서사) — 고정 배정. CLUB_IDENTITY_SYSTEM.
// TEAM_NAMES 순서와 1:1. 매 게임 동일(명문은 늘 명문) → lore 축적.
// 생성 노브(strengthBias·ageRange)는 seed.ts가, 표시 프로필은 UI가 읽는다.
// 엔진(경기/생산/연봉/노쇠)은 정체성을 모른다 — SOLID: 정체성은 "시작 조건"일 뿐.

import type { ClubIdentity } from '../types';

// 현재 연도 기준(서사용) — 창단연도/통산우승의 척도. 실제 시즌 진행과 무관(표시 전용).
const NOW = 2026;

// strengthBias 합 = 0 → 리그 평균 전력 보존(대칭).
// recentRanks: 최근→과거(index0=이전 시즌). **각 시즌(열)이 그 시즌 존재 팀들의 순위 1..N 유일 순열**이어야
//   한다 — 한 시즌에 1위·꼴찌는 각 한 팀뿐. 아키타입 성격(명문=상위·만년약체=하위·신흥=상승·황혼=하락)을
//   지키면서 열 정합을 맞췄다. 신생팀(expansion)은 최근 1시즌만 존재(그 시즌 7위), 그 이전 시즌은 6팀(1..6).
//   조율 검증: `npx tsx tools/checkClubRanks.ts`(열별 순열 가드 — 아키타입별 비조율 작성 회귀 차단).
export const CLUB_IDENTITIES: ClubIdentity[] = [
  {
    key: 'dynasty', label: '명문', tagline: '전통의 명가',
    blurb: '리그를 대표하는 전통의 강호. 두꺼운 선수층과 우승 DNA로 매 시즌 우승을 다툰다.',
    foundedYear: 1998, titles: 7, tradition: 95,
    recentRanks: [1, 1, 2, 1, 2], // 명문: 우승 단골(3회)·가끔 준우승
    strengthBias: 3.5, ageRange: [23, 33], hue: 218, // 인천 타이드 — 딥블루(바다/전통)
  },
  {
    key: 'aging', label: '황혼의 명가', tagline: '저무는 왕조',
    blurb: '한 시대를 풍미했지만 주축이 노쇠한 황혼의 명가. 어쩌면 지금이 마지막 전성기다.',
    foundedYear: 2001, titles: 5, tradition: 82,
    recentRanks: [4, 4, 3, 2, 1], // 황혼: 5시즌 전 우승(1) → 하락(4)
    strengthBias: 1.5, ageRange: [26, 35], hue: 278, // 수원 페어리스 — 바이올렛(요정/황혼)
  },
  {
    key: 'rising', label: '신흥 강호', tagline: '떠오르는 다크호스',
    blurb: '젊은 코어가 폭발하며 강팀으로 떠오른 다크호스. 미래가 더 무섭다.',
    foundedYear: 2015, titles: 1, tradition: 44,
    recentRanks: [2, 3, 1, 4, 5], // 신흥: 5위→우승 한 번→2위 정착(상승)
    strengthBias: 2.0, ageRange: [19, 26], hue: 6, // 대전 블레이즈 — 스칼렛(불꽃/폭발)
  },
  {
    key: 'cellar', label: '만년 약체', tagline: '하위권의 그늘',
    blurb: '수년째 하위권을 벗어나지 못한 만년 약체. 반등의 계기가 절실하다.',
    foundedYear: 2009, titles: 0, tradition: 22,
    recentRanks: [6, 5, 5, 6, 6], // 만년약체: 하위 고정(5~6위)
    strengthBias: -2.0, ageRange: [20, 33], hue: 332, // 광주 페퍼스 — 마젠타핑크(페퍼)
  },
  {
    key: 'midpack', label: '중위권', tagline: '봄배구의 문턱',
    blurb: '꾸준한 중위권. 한 끗이 모자라 봄배구 문턱에서 멈춰 서곤 한다.',
    foundedYear: 2007, titles: 1, tradition: 51,
    recentRanks: [3, 2, 4, 3, 3], // 중위권: 3위권에서 오르내림
    strengthBias: 0, ageRange: [21, 32], hue: 190, // 김천 코메츠 — 시안(혜성)
  },
  {
    key: 'expansion', label: '신생팀', tagline: '백지의 도전',
    blurb: '이제 막 창단한 신생 구단. 당장의 전력은 약하지만 유망주로 가득해 잠재력은 최고다.',
    foundedYear: 2024, titles: 0, tradition: 6,
    recentRanks: [7],
    strengthBias: -3.5, ageRange: [19, 23], hue: 43, // 화성 윙스 — 앰버골드(날개)
  },
  {
    key: 'rebuild', label: '리빌딩', tagline: '판을 다시 짜다',
    blurb: '전성기를 보낸 뒤 어린 선수 위주로 판을 다시 짜는 리빌딩 구단. 인내가 필요한 시기.',
    foundedYear: 2012, titles: 0, tradition: 31,
    recentRanks: [5, 6, 6, 5, 4], // 리빌딩: 4위→6위 추락→회복 중
    strengthBias: -1.5, ageRange: [19, 28], hue: 148, // 서울 스파이커스 — 그린(새 출발)
  },
];

/** 팀 인덱스(생성 순서) → 정체성. 정체성 수보다 팀이 많으면 순환. */
export function clubIdentityByIndex(i: number): ClubIdentity {
  return CLUB_IDENTITIES[i % CLUB_IDENTITIES.length];
}

/** teamId('t0'..) → 정체성. 비표준 id면 undefined. */
export function clubIdentity(teamId: string): ClubIdentity | undefined {
  const m = /^t(\d+)$/.exec(teamId);
  if (!m) return undefined;
  return clubIdentityByIndex(Number(m[1]));
}

/** 창단 후 연수(서사 표시) */
export const clubAgeYears = (id: ClubIdentity): number => Math.max(0, NOW - id.foundedYear);

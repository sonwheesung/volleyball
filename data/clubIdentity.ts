// 구단 정체성(서사) — 고정 배정. CLUB_IDENTITY_SYSTEM.
// TEAM_NAMES 순서와 1:1. 매 게임 동일(명문은 늘 명문) → lore 축적.
// 생성 노브(strengthBias·ageRange)는 seed.ts가, 표시 프로필은 UI가 읽는다.
// 엔진(경기/생산/연봉/노쇠)은 정체성을 모른다 — SOLID: 정체성은 "시작 조건"일 뿐.

import type { ClubIdentity } from '../types';

// 현재 연도 기준(서사용) — 창단연도/통산우승의 척도. 실제 시즌 진행과 무관(표시 전용).
const NOW = 2026;

// strengthBias 합 = 0 → 리그 평균 전력 보존(대칭).
export const CLUB_IDENTITIES: ClubIdentity[] = [
  {
    key: 'dynasty', label: '명문', tagline: '전통의 명가',
    blurb: '리그를 대표하는 전통의 강호. 두꺼운 선수층과 우승 DNA로 매 시즌 우승을 다툰다.',
    foundedYear: 1998, titles: 7, tradition: 95,
    recentRanks: [1, 2, 1, 3, 2],
    strengthBias: 3.5, ageRange: [23, 33],
  },
  {
    key: 'aging', label: '황혼의 명가', tagline: '저무는 왕조',
    blurb: '한 시대를 풍미했지만 주축이 노쇠한 황혼의 명가. 어쩌면 지금이 마지막 전성기다.',
    foundedYear: 2001, titles: 5, tradition: 82,
    recentRanks: [1, 2, 2, 4, 5],
    strengthBias: 1.5, ageRange: [26, 35],
  },
  {
    key: 'rising', label: '신흥 강호', tagline: '떠오르는 다크호스',
    blurb: '젊은 코어가 폭발하며 강팀으로 떠오른 다크호스. 미래가 더 무섭다.',
    foundedYear: 2015, titles: 1, tradition: 44,
    recentRanks: [7, 6, 4, 2, 2],
    strengthBias: 2.0, ageRange: [19, 26],
  },
  {
    key: 'cellar', label: '만년 약체', tagline: '하위권의 그늘',
    blurb: '수년째 하위권을 벗어나지 못한 만년 약체. 반등의 계기가 절실하다.',
    foundedYear: 2009, titles: 0, tradition: 22,
    recentRanks: [7, 6, 7, 7, 6],
    strengthBias: -2.0, ageRange: [20, 33],
  },
  {
    key: 'midpack', label: '중위권', tagline: '봄배구의 문턱',
    blurb: '꾸준한 중위권. 한 끗이 모자라 봄배구 문턱에서 멈춰 서곤 한다.',
    foundedYear: 2007, titles: 1, tradition: 51,
    recentRanks: [4, 5, 3, 4, 5],
    strengthBias: 0, ageRange: [21, 32],
  },
  {
    key: 'expansion', label: '신생팀', tagline: '백지의 도전',
    blurb: '이제 막 창단한 신생 구단. 당장의 전력은 약하지만 유망주로 가득해 잠재력은 최고다.',
    foundedYear: 2024, titles: 0, tradition: 6,
    recentRanks: [7],
    strengthBias: -3.5, ageRange: [19, 23],
  },
  {
    key: 'rebuild', label: '리빌딩', tagline: '판을 다시 짜다',
    blurb: '전성기를 보낸 뒤 어린 선수 위주로 판을 다시 짜는 리빌딩 구단. 인내가 필요한 시기.',
    foundedYear: 2012, titles: 0, tradition: 31,
    recentRanks: [3, 5, 7, 6, 7],
    strengthBias: -1.5, ageRange: [19, 28],
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

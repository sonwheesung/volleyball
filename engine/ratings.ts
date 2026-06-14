// 2층 스탯 산출 (CLAUDE.md 5.2) — 밑단(세부) → 윗단(종합).
// 윗단은 표시용이자 엔진 입력. 계수는 전부 placeholder, 밸런싱 단계 튜닝 대상.

import type { Player } from '../types';

export interface Ratings {
  spike: number;
  block: number;
  dig: number;
  receive: number;
  set: number;   // 팀 공격 전체에 곱해지는 승수
  serve: number;
}

const norm = (v: number) => v / 100;

// 키를 공격용 풀레인지로 정규화: 165cm→0, 195cm→1 (여자배구 실효 구간). 다른 레이팅의 0~1 입력과 스케일 정합.
const spikeHeight = (h: number) => clampN((h - 165) / 30);
// 블로킹용 키: 완화 레인지(165→0, 205→1). 풀레인지는 팀 간 블록 격차가 ×3.3로 벌어져
// 장신 MB 보유팀 왕조 고착(다중 유니버스 9연패) → 중간 기울기로 절충(2026-06).
const blockHeight = (h: number) => clampN((h - 165) / 40);
const clampN = (v: number) => Math.max(0, Math.min(1, v));

export function deriveRatings(p: Player): Ratings {
  const jump = norm(p.jump);
  const agility = norm(p.agility);
  const reaction = norm(p.reaction);
  const positioning = norm(p.positioning);
  const focus = norm(p.focus);
  const consistency = norm(p.consistency);

  return {
    // 스파이크 = f(키, 점프력, 공격기술) × 기복보정.
    //   키는 풀레인지(spikeHeight)로 — 장신 공격수가 제대로 보상받게.
    //   consistency는 ×c(−30%)가 아니라 (0.8+0.2·c) 약보정 — 기복은 OVR 멘탈로도 별도 반영.
    spike: clamp((0.28 * spikeHeight(p.height) + 0.32 * jump + 0.4 * norm(p.skSpike)) * 100 * (0.8 + 0.2 * consistency)),
    // 블로킹 = f(키, 점프력, 반응속도, 블로킹기술)
    //   키는 완화 레인지(blockHeight) — 장신 보상은 살리되 팀 간 격차 폭주 방지(2026-06)
    block: clamp((0.3 * blockHeight(p.height) + 0.25 * jump + 0.2 * reaction + 0.25 * norm(p.skBlock)) * 100),
    // 디그 = f(민첩성, 반응속도, 위치선정, 디그기술) — 반응 비중↓·전용기술↑(2026-06-14, 반응 과대 가중 보정)
    dig: clamp((0.25 * agility + 0.2 * reaction + 0.25 * positioning + 0.3 * norm(p.skDig)) * 100),
    // 리시브 = f(반응속도, 위치선정, 리시브기술) — 반응(0.35→0.25)↓·리시브기술(0.35→0.45)↑
    //   반응속도가 전용 기술과 동급이던 걸 완화 — 리시브는 기술·읽기 주도(2026-06-14)
    receive: clamp((0.25 * reaction + 0.3 * positioning + 0.45 * norm(p.skReceive)) * 100),
    // 세팅 = f(세팅기술, 집중력)
    set: clamp((0.7 * norm(p.skSet) + 0.3 * focus) * 100),
    // 서브 = f(서브기술, 집중력)
    serve: clamp((0.7 * norm(p.skServe) + 0.3 * focus) * 100),
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

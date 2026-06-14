// 뉴스 피드 (NEWS_SYSTEM, 캡스톤). 자동 진행된 리그를 읽을 수 있는 기사로.
// ★ 새 저장 없음 — archive(시상)·milestones·hallOfFame·injuries 에서 순수 파생(결정론).
//   가짜 드라마 금지: 기록에 근거한 사실만. 중요도(big)로 헤드라인/단신 구분.

import type { ExpelRecord, HofEntry, Milestone, NewsItem, SeasonAwards } from '../types';
import { getPlayer, getTeam } from './league';
import { seasonInjuryReport } from './injury';
import { SEVERITY_KO } from '../engine/injury';
import { seasonScandals } from './dynamics';
import { SCANDAL_KO, EXPEL_KO } from '../engine/scandal';

const teamName = (id: string) => getTeam(id)?.name ?? id;
const pName = (id: string) => getPlayer(id)?.name ?? id;

type ArchiveEntry = { season: number; championId: string; awards?: SeasonAwards };

/** 전체 뉴스 피드(최신 시즌 우선, 같은 시즌 내 헤드라인 우선) */
export function buildNewsFeed(
  archive: ArchiveEntry[],
  milestones: Milestone[],
  hallOfFame: HofEntry[],
  currentSeason: number,
  expelled: ExpelRecord[] = [],
): NewsItem[] {
  const items: NewsItem[] = [];
  const push = (season: number, kind: NewsItem['kind'], headline: string, big: boolean, teamId?: string) =>
    items.push({ season, kind, headline, big, teamId });

  // 1) 역대 시즌 — 우승 + 시상
  for (const a of archive) {
    if (a.championId) push(a.season, 'champion', `${a.season + 1}시즌 우승 — ${teamName(a.championId)}`, true, a.championId);
    const aw = a.awards;
    if (!aw) continue;
    if (aw.mvp) push(a.season, 'award', `정규리그 MVP — ${pName(aw.mvp.playerId)} (${teamName(aw.mvp.teamId)})`, true, aw.mvp.teamId);
    if (aw.finalsMvp) push(a.season, 'award', `챔프전 MVP — ${pName(aw.finalsMvp.playerId)}`, false, aw.finalsMvp.teamId);
    if (aw.rookie) push(a.season, 'award', `신인상 — ${pName(aw.rookie.playerId)} (${teamName(aw.rookie.teamId)})`, false, aw.rookie.teamId);
    if (aw.mostImproved) push(a.season, 'award', `기량발전상 — ${pName(aw.mostImproved.playerId)}`, false, aw.mostImproved.teamId);
    if (aw.titles.scoring) push(a.season, 'award', `득점왕 — ${pName(aw.titles.scoring.playerId)} ${aw.titles.scoring.value}점`, false, aw.titles.scoring.teamId);
  }

  // 2) 마일스톤(기록 경신)
  for (const m of milestones) push(m.season, 'milestone', m.text, m.big, m.teamId);

  // 3) 명예의전당 헌액
  for (const h of hallOfFame) {
    push(h.retiredSeason, 'hof', `${h.name}, 명예의전당 헌액${h.legend ? ' · 영구결번' : ''} (통산 ${h.points.toLocaleString()}점)`, h.legend, h.teamId);
  }

  // 4) 이번 시즌 큰 부상(중상·시즌아웃만 — 경미는 단신 제외)
  for (const s of seasonInjuryReport()) {
    if (s.severity !== 'major' && s.severity !== 'season') continue;
    push(currentSeason, 'injury', `${pName(s.playerId)} ${SEVERITY_KO[s.severity]} — ${s.severity === 'season' ? '시즌아웃' : `${s.missMatches}경기 결장`}`, s.severity === 'season', s.teamId);
  }

  // 5) 사건·사고 — 아주 가끔, 리그를 뒤흔드는 헤드라인
  for (const s of seasonScandals()) {
    push(currentSeason, 'scandal', `[단독] ${pName(s.playerId)}(${teamName(s.teamId)}), ${SCANDAL_KO[s.kind]} — ${s.missMatches}경기 출장 정지`, true, s.teamId);
  }

  // 6) 영구제명 — 리그를 뒤흔드는 최대 사건(승부조작·학폭). 영속 기록에서.
  for (const e of expelled) {
    push(e.season, 'scandal', `[속보] ${e.name}(${teamName(e.teamId)}), ${EXPEL_KO[e.kind]} 적발 — 영구제명(리그 영구 퇴출)`, true, e.teamId);
  }

  return items.sort((x, y) => y.season - x.season || Number(y.big) - Number(x.big));
}

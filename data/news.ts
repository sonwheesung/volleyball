// 뉴스 피드 (NEWS_SYSTEM, 캡스톤). 자동 진행된 리그를 읽을 수 있는 기사로.
// ★ 새 저장 없음 — archive(시상)·milestones·hallOfFame·injuries 에서 순수 파생(결정론).
//   가짜 드라마 금지: 기록에 근거한 사실만. 중요도(big)로 헤드라인/단신 구분.

import type { ExpelRecord, HofEntry, Milestone, NewsItem, SeasonAwards } from '../types';
import type { BenchDirective } from '../engine/owner';
import { getPlayer, getTeam } from './league';
import { popularityNow } from './owner';
import { seasonInjuryReport } from './injury';
import { SEVERITY_KO } from '../engine/injury';
import { seasonScandals } from './dynamics';
import { SCANDAL_KO, EXPEL_KO } from '../engine/scandal';

const teamName = (id: string) => getTeam(id)?.name ?? id;
const pName = (id: string) => getPlayer(id)?.name ?? id;
const POS_KO: Record<string, string> = { S: '세터', OH: '아웃사이드 히터', OP: '아포짓', MB: '미들 블로커', L: '리베로' };
const posKoOf = (id: string) => POS_KO[getPlayer(id)?.position ?? ''] ?? '주전';

type ArchiveEntry = { season: number; championId: string; awards?: SeasonAwards };

/** 뉴스 안정 키 — id가 없으므로 결정론 필드 조합. 읽음/안읽음 추적용(store.readNews). */
export const newsKey = (n: NewsItem) => `${n.season}:${n.kind}:${n.headline}`;

/** 전체 뉴스 피드(최신 시즌 우선, 같은 시즌 내 헤드라인 우선) */
export function buildNewsFeed(
  archive: ArchiveEntry[],
  milestones: Milestone[],
  hallOfFame: HofEntry[],
  currentSeason: number,
  expelled: ExpelRecord[] = [],
  benchDirectives: BenchDirective[] = [], // 구단주 벤치 지시(내 팀, 현재 시즌) — 인기 스타 벤치 → 팬 술렁
  currentDay = 0,
  myTeamId = '',
): NewsItem[] {
  const items: NewsItem[] = [];
  const push = (season: number, kind: NewsItem['kind'], headline: string, big: boolean, teamId?: string, body?: string) =>
    items.push({ season, kind, headline, big, teamId, body });

  // 1) 역대 시즌 — 우승 + 시상
  for (const a of archive) {
    const aw = a.awards;
    if (a.championId) push(a.season, 'champion', `${a.season + 1}시즌 우승 — ${teamName(a.championId)}`, true, a.championId,
      `${teamName(a.championId)}이(가) ${a.season + 1}시즌 정규리그와 포스트시즌을 모두 통과하며 정상에 올랐다.`
      + (aw?.mvp ? ` 정규리그 MVP ${pName(aw.mvp.playerId)}을(를) 앞세운 한 시즌이었다.` : '')
      + (aw?.finalsMvp ? ` 챔피언결정전에서는 ${pName(aw.finalsMvp.playerId)}이(가) MVP로 정상의 마침표를 찍었다.` : '')
      + ' 길고 치열했던 한 시즌의 마지막 승자가 됐다.');
    if (!aw) continue;
    if (aw.mvp) push(a.season, 'award', `정규리그 MVP — ${pName(aw.mvp.playerId)} (${teamName(aw.mvp.teamId)})`, true, aw.mvp.teamId,
      `${pName(aw.mvp.playerId)}(${teamName(aw.mvp.teamId)})이(가) ${a.season + 1}시즌 정규리그 MVP에 선정됐다. 시즌 내내 이어진 코트 위 생산과 팀 성적이 함께 만든 결과다. 한 시즌을 대표하는 이름으로 기록에 남는다.`);
    if (aw.finalsMvp) push(a.season, 'award', `챔프전 MVP — ${pName(aw.finalsMvp.playerId)}`, false, aw.finalsMvp.teamId,
      `${pName(aw.finalsMvp.playerId)}이(가) 챔피언결정전 최우수선수로 뽑혔다. 가장 큰 무대에서 가장 빛난 활약이었다.`);
    if (aw.rookie) push(a.season, 'award', `신인상 — ${pName(aw.rookie.playerId)} (${teamName(aw.rookie.teamId)})`, false, aw.rookie.teamId,
      `${pName(aw.rookie.playerId)}(${teamName(aw.rookie.teamId)})이(가) ${a.season + 1}시즌 신인상을 받았다. 데뷔 시즌부터 코트에서 존재감을 보이며 다음 세대의 얼굴로 떠올랐다.`);
    if (aw.mostImproved) push(a.season, 'award', `기량발전상 — ${pName(aw.mostImproved.playerId)}`, false, aw.mostImproved.teamId,
      `${pName(aw.mostImproved.playerId)}이(가) ${a.season + 1}시즌 기량발전상의 주인공이 됐다. 지난 시즌 대비 가장 크게 성장한 선수로 꼽혔다.`);
    if (aw.titles.scoring) push(a.season, 'award', `득점왕 — ${pName(aw.titles.scoring.playerId)} ${aw.titles.scoring.value}점`, false, aw.titles.scoring.teamId,
      `${pName(aw.titles.scoring.playerId)}이(가) 통산 ${aw.titles.scoring.value}점으로 ${a.season + 1}시즌 득점 1위에 올랐다. 한 시즌 내내 팀 공격을 책임진 결과다.`);
  }

  // 2) 마일스톤(기록 경신)
  for (const m of milestones) push(m.season, 'milestone', m.text, m.big, m.teamId,
    `${m.text} 세월이 쌓여 만들어진 기록이며, ${m.kind === 'league' ? '리그 역사에' : m.kind === 'club' ? '구단 역사에' : '개인 통산 기록에'} 새로 새겨졌다.`);

  // 3) 명예의전당 헌액
  for (const h of hallOfFame) {
    push(h.retiredSeason, 'hof', `${h.name}, 명예의전당 헌액${h.legend ? ' · 영구결번' : ''} (통산 ${h.points.toLocaleString()}점)`, h.legend, h.teamId,
      `${h.name}이(가) ${h.seasons}시즌의 커리어를 마치고 명예의전당에 헌액됐다. ${teamName(h.teamId)}에서 통산 ${h.points.toLocaleString()}점·블로킹 ${h.blocks.toLocaleString()}개·디그 ${h.digs.toLocaleString()}개를 남겼다.`
      + (h.legend ? ` 구단은 등번호를 영구결번으로 올려 그의 발자취를 영원히 기린다.` : ` 통산 기록은 리그에 영구히 보존된다.`));
  }

  // 4) 이번 시즌 큰 부상(중상·시즌아웃만 — 경미는 단신 제외)
  for (const s of seasonInjuryReport()) {
    if (s.severity !== 'major' && s.severity !== 'season') continue;
    const out = s.severity === 'season' ? '시즌아웃' : `약 ${s.missMatches}경기 결장`;
    push(currentSeason, 'injury', `${pName(s.playerId)} ${SEVERITY_KO[s.severity]} — ${out}`, s.severity === 'season', s.teamId,
      `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SEVERITY_KO[s.severity]} 판정을 받아 ${out}이(가) 예상된다. `
      + `${teamName(s.teamId)}은(는) 당분간 ${posKoOf(s.playerId)} 자리를 백업 자원과 로테이션 조정으로 메워야 한다. `
      + (s.severity === 'season'
        ? '시즌 복귀가 어려운 만큼 남은 일정의 전력 공백이 불가피하다.'
        : '복귀 시점과 경기 감각 회복이 시즌 후반 순위 싸움의 변수가 될 전망이다.'));
  }

  // 5) 사건·사고 — 아주 가끔, 리그를 뒤흔드는 헤드라인
  for (const s of seasonScandals()) {
    push(currentSeason, 'scandal', `[단독] ${pName(s.playerId)}(${teamName(s.teamId)}), ${SCANDAL_KO[s.kind]} — ${s.missMatches}경기 출장 정지`, true, s.teamId,
      `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SCANDAL_KO[s.kind]}으로 ${s.missMatches}경기 출장 정지 징계를 받았다. 구단과 리그는 후속 조치를 검토 중이며, 팀은 핵심 자원을 잃은 채 일정을 소화하게 됐다.`);
  }

  // 6) 영구제명 — 리그를 뒤흔드는 최대 사건(승부조작·학폭). 영속 기록에서.
  for (const e of expelled) {
    push(e.season, 'scandal', `[속보] ${e.name}(${teamName(e.teamId)}), ${EXPEL_KO[e.kind]} 적발 — 영구제명(리그 영구 퇴출)`, true, e.teamId,
      `${e.name}(${teamName(e.teamId)})이(가) ${EXPEL_KO[e.kind]}으로 적발돼 리그에서 영구제명됐다. 코트로 돌아올 수 없으며, 그의 이름은 불명예 기록으로만 남는다. 리그를 뒤흔든 최악의 사건이다.`);
  }

  // 7) 구단주 — 인기 스타를 벤치로 보낸 건의가 받아들여졌을 때 팬심이 술렁(OWNER_SYSTEM 팬 분노 연동)
  for (const b of benchDirectives) {
    const p = getPlayer(b.playerId); if (!p) continue;
    const pop = popularityNow(p, currentDay, archive);
    if (pop < 60) continue; // 인기 스타만 — 무명 선수 벤치는 기사 안 남
    push(currentSeason, 'owner', `팬들, 간판 ${p.name} 벤치 기용에 술렁 — "왜 안 쓰나"`, pop >= 78, myTeamId,
      `${teamName(myTeamId)}의 간판 ${p.name}이(가) 최근 출전 명단에서 빠지면서 팬들이 술렁이고 있다. "왜 안 쓰나"라는 목소리가 커지는 가운데, 구단 운영은 성적만큼이나 팬 정서도 함께 살펴야 하는 국면에 들어섰다.`);
  }

  return items.sort((x, y) => y.season - x.season || Number(y.big) - Number(x.big));
}

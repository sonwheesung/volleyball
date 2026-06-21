// 뉴스 피드 (NEWS_SYSTEM, 캡스톤). 자동 진행된 리그를 읽을 수 있는 기사로.
// ★ 새 저장 없음 — archive(시상·순위·연승·플옵)·milestones·hallOfFame·injuries 에서 순수 파생(결정론).
//   가짜 드라마 금지: 기록에 근거한 사실만. 중요도(big)로 헤드라인/단신 구분.
//   본문은 조립식(opener+사실+closer) + 안정 시드 변주 → 같은 종류라도 표현이 다르다(NEWS_SYSTEM §4).

import type { ExpelRecord, HofEntry, Milestone, NewsItem, Position, SeasonArchive, SeasonAwards } from '../types';
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

/** 뉴스 안정 키 — 안정 식별자(ref: playerId 등) + 헤드라인 조합. 동명이인 충돌 방지(§4.4). 읽음 추적용. */
export const newsKey = (n: NewsItem) => `${n.season}:${n.kind}:${n.ref ?? ''}:${n.headline}`;

// ─── 변주 엔진 (NEWS_SYSTEM §4.2) ─────────────────────────────
// 안정 시드 해시(FNV-1a). 같은 키 → 같은 변형(리플레이 일치), 다른 기사 → 다른 변형.
const hashStr = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/** 풀에서 키 기반 결정론 선택. salt로 독립 스트림(opener/closer 따로). */
const vp = <T>(arr: T[], key: string, salt = 0): T => arr[hashStr(`${key}|${salt}`) % arr.length];
/** 본문 조립: opener + 사실(core) + closer. open/close는 채널별 풀, core는 정확한 사실. */
const body3 = (channel: string, key: string, core: string): string => {
  const p = POOLS[channel] ?? POOLS.generic;
  return `${vp(p.open, key, 1)} ${core} ${vp(p.close, key, 2)}`;
};
/** 헤드라인 변형 — 풀에서 키 기반 선택(폼만 다름, 사실은 인자로). */
const vh = (forms: ((s: string) => string)[], key: string, arg: string): string => vp(forms, key, 0)(arg);

// 채널별 도입/마무리 풀(각 3~4 → 조합 9~16). 사실은 절대 변형 안 함(가짜 드라마 금지).
const POOLS: Record<string, { open: string[]; close: string[] }> = {
  generic: {
    open: ['소식이 전해졌다.', '한 장면이 기록에 남았다.', '리그가 주목한 순간이다.'],
    close: ['시즌의 한 페이지로 남는다.', '기록은 오래 회자될 것이다.', '세월이 쌓여 만들어진 장면이다.'],
  },
  champion: {
    open: ['길고 치열했던 한 시즌의 마지막 승자가 가려졌다.', '정규리그부터 포스트시즌까지, 모든 길의 끝에 한 팀이 섰다.', '시즌을 지배한 팀이 마침내 정상에 우뚝 섰다.', '한 시즌의 모든 드라마가 이 우승으로 수렴했다.', '왕좌의 주인이 가려졌다.', '봄배구의 마지막 주인공이 정해졌다.'],
    close: ['우승의 무게는 고스란히 다음 시즌의 도전으로 이어진다.', '정상의 이름으로 리그 역사에 또 한 줄이 새겨졌다.', '팬들은 오래도록 이 시즌을 기억할 것이다.', '왕좌는 잠시, 도전은 다시 시작된다.', '한 시즌을 관통한 저력이 끝내 정상에서 증명됐다.'],
  },
  award: {
    open: ['한 시즌의 활약이 끝내 상으로 보답받았다.', '코트 위에서 쌓아 올린 생산이 만든 결과다.', '시즌 내내 이어진 꾸준함의 결실이다.', '숫자가 증명한 한 시즌이었다.'],
    close: ['이름은 그해를 대표하는 기록으로 남는다.', '다음 시즌을 향한 기대를 함께 키운다.', '한 시즌을 대표하는 장면으로 자리매김했다.', '수상의 영예는 통산 이력에 또 하나의 훈장으로 더해진다.'],
  },
  king: {
    open: ['부문 1위는 한 시즌의 꾸준함이 만든다.', '시즌 내내 그 자리를 지켜낸 결과다.', '기록은 끝내 거짓말을 하지 않았다.', '한 부문에서만큼은 누구도 넘보지 못했다.'],
    close: ['타이틀은 고스란히 통산 기록에 더해진다.', '한 부문을 통째로 지배한 한 해였다.', '다음 시즌에도 왕좌를 지킬지 주목된다.', '부문 최강의 자리를 숫자로 증명했다.'],
  },
  best7: {
    open: ['시즌을 빛낸 최고의 선수들이 호명됐다.', '포지션별 최고가 한자리에 모였다.', '한 시즌의 베스트 라인업이 가려졌다.', '코트를 지배한 일곱 이름이 발표됐다.'],
    close: ['선정 자체가 한 시즌의 훈장이다.', '이름들은 고스란히 시즌 아카이브에 남는다.', '기록과 활약이 함께 만든 영예다.', '한 시즌 최고의 무대를 채운 얼굴들이다.'],
  },
  streakWin: {
    open: ['거침없는 질주였다.', '아무도 막아서지 못한 흐름이었다.', '승리가 또 다른 승리를 불렀다.', '상승세에 제동이 걸리지 않았다.'],
    close: ['연승의 기억은 고스란히 시즌의 자산이 된다.', '상승세는 순위 싸움의 든든한 발판이 됐다.', '코트 위 자신감이 결과로 증명됐다.', '분위기를 탄 팀은 좀처럼 멈추지 않았다.'],
  },
  streakLose: {
    open: ['길고 어두운 터널이었다.', '좀처럼 출구가 보이지 않았다.', '반등의 실마리가 절실했다.', '악순환의 고리를 끊지 못했다.'],
    close: ['연패의 시간도 시즌의 일부로 기록된다.', '바닥에서 다시 일어서는 일이 숙제로 남았다.', '팀은 분위기 전환의 계기를 찾아야 했다.', '긴 부진의 끝을 스스로 만들어야 하는 처지다.'],
  },
  standing: {
    open: ['시즌의 성적표가 한 줄로 정리됐다.', '최종 순위가 모든 것을 말해준다.', '한 시즌의 여정이 끝내 숫자로 남았다.', '정규리그 레이스의 결말이 나왔다.'],
    close: ['다음 시즌의 출발선이 여기서 정해진다.', '순위는 곧 다음 도전의 무게가 된다.', '성적은 고스란히 팬심과 곳간으로 이어진다.', '한 시즌의 평가가 이 한 줄에 담겼다.'],
  },
  milestone: {
    open: ['세월이 쌓여 만들어진 기록이다.', '꾸준함이 끝내 임계를 넘어선 순간이었다.', '한 선수의 시간이 숫자로 새겨졌다.', '오랜 누적이 마침내 한 고비를 넘었다.'],
    close: ['기록은 리그에 영원히 보존된다.', '다음 고지가 벌써 눈앞에 다가왔다.', '통산의 발자취에 또 한 칸이 더해졌다.', '한 선수의 커리어에 굵은 이정표가 세워졌다.'],
  },
  hof: {
    open: ['한 시대가 막을 내렸다.', '오랜 커리어가 끝내 명예로 마무리됐다.', '코트를 떠나는 이름이 전당에 새겨졌다.', '한 선수의 긴 여정이 영광으로 봉인됐다.'],
    close: ['통산 기록은 리그에 영구히 남는다.', '그의 발자취는 후배들의 이정표가 된다.', '은퇴는 끝이 아니라 또 다른 기록의 시작이다.', '코트를 떠나도 이름은 전당에 영원히 걸린다.'],
  },
  injury: {
    open: ['반갑지 않은 소식이다.', '팀에 전력 공백이 생겼다.', '코트 밖 변수가 순위에 끼어들었다.'],
    close: ['복귀 시점이 시즌 후반의 변수가 된다.', '백업 자원의 분발이 필요해졌다.', '팀은 로테이션 조정으로 공백을 메워야 한다.'],
  },
  scandal: {
    open: ['리그를 뒤흔든 소식이다.', '코트 밖에서 터진 사건이다.', '예상치 못한 후폭풍이 일었다.'],
    close: ['구단과 리그는 후속 조치를 검토 중이다.', '팀은 핵심 자원을 잃은 채 일정을 소화하게 됐다.', '여파는 시즌 내내 이어질 전망이다.'],
  },
  owner: {
    open: ['관중석이 술렁였다.', '팬심이 출렁인 한 장면이다.', '코트 밖 여론이 움직였다.'],
    close: ['구단 운영은 성적만큼이나 정서도 살펴야 한다.', '팬과 구단 사이의 거리가 시험대에 올랐다.', '여론의 향배가 다음 행보에 영향을 줄 전망이다.'],
  },
};

const TITLE_KO: Record<string, string> = {
  scoring: '득점', spike: '공격 성공', block: '블로킹', serve: '서브', dig: '디그', set: '세트(어시스트)', receive: '리시브',
};
const TITLE_UNIT: Record<string, string> = { scoring: '점', spike: '개', block: '개', serve: '개', dig: '개', set: '개', receive: '개' };
const SUB_TITLES: (keyof SeasonAwards['titles'])[] = ['spike', 'block', 'serve', 'dig', 'set', 'receive'];
const BEST7_ORDER: Position[] = ['S', 'OH', 'OP', 'MB', 'L'];

/** 전체 뉴스 피드(최신 시즌 우선, 같은 시즌 내 헤드라인 우선) */
export function buildNewsFeed(
  archive: SeasonArchive[],
  milestones: Milestone[],
  hallOfFame: HofEntry[],
  currentSeason: number,
  expelled: ExpelRecord[] = [],
  benchDirectives: BenchDirective[] = [], // 구단주 벤치 지시(내 팀, 현재 시즌) — 인기 스타 벤치 → 팬 술렁
  currentDay = 0,
  myTeamId = '',
): NewsItem[] {
  const items: NewsItem[] = [];
  const push = (season: number, kind: NewsItem['kind'], headline: string, big: boolean, teamId?: string, body?: string, ref?: string) =>
    items.push({ season, kind, headline, big, teamId, body, ref });

  // 1) 역대 시즌 — 우승 + 시상 + 순위·연승·플옵 서사
  for (const a of archive) {
    const S = a.season + 1;
    const aw = a.awards;
    const key = (suffix: string) => `${a.season}:${suffix}`; // 안정 변주 키

    // ── 우승(+ 플옵 시리즈 명장면) ──
    if (a.championId) {
      const champSeries = a.series?.[a.championId]?.find((s) => s.length >= 3);
      const sweep = champSeries && champSeries.length === 3 && champSeries.every((g) => g === 'W');
      const reverse = champSeries && champSeries.length === 5 && champSeries[0] === 'L' && champSeries[1] === 'L' && champSeries.slice(2).every((g) => g === 'W');
      const tag = reverse ? ' — 리버스 스윕 대역전' : sweep ? ' — 3-0 스윕' : '';
      const core = `${teamName(a.championId)}이(가) ${S}시즌 정상에 올랐다.`
        + (reverse ? ' 챔피언결정전에서 2패 뒤 3연승, 리버스 스윕의 대역전 우승이었다.' : sweep ? ' 챔피언결정전을 3-0 스윕으로 끝낸 완벽한 대관식이었다.' : '')
        + (aw?.mvp ? ` 정규리그 MVP ${pName(aw.mvp.playerId)}을(를) 앞세웠다.` : '')
        + (aw?.finalsMvp ? ` 챔프전 MVP는 ${pName(aw.finalsMvp.playerId)}의 몫이었다.` : '');
      push(a.season, 'champion', vh([
        (t) => `${S}시즌 우승 — ${t}${tag}`,
        (t) => `${t}, ${S}시즌 정상 등극${tag}`,
        (t) => `${S}시즌 챔피언 ${t}${tag}`,
        (t) => `${t}, ${S}시즌 정상에 우뚝${tag}`,
      ], key('champ'), teamName(a.championId)), true, a.championId, body3('champion', key('champ'), core));
    }
    if (!aw) continue;

    // ── 정규/챔프 MVP ──
    if (aw.mvp) push(a.season, 'award', vh([
      (n) => `정규리그 MVP — ${n} (${teamName(aw.mvp!.teamId)})`,
      (n) => `${S}시즌 MVP는 ${n}`,
      (n) => `리그 최고의 이름, ${n}`,
    ], key('mvp'), pName(aw.mvp.playerId)), true, aw.mvp.teamId,
      body3('award', key('mvp'), `${pName(aw.mvp.playerId)}(${teamName(aw.mvp.teamId)})이(가) ${S}시즌 정규리그 MVP에 선정됐다. 코트 위 생산과 팀 성적이 함께 만든 결과다.`), aw.mvp.playerId);
    if (aw.finalsMvp) push(a.season, 'award', vh([
      (n) => `챔프전 MVP — ${n}`,
      (n) => `가장 큰 무대의 주인공, ${n}`,
    ], key('fmvp'), pName(aw.finalsMvp.playerId)), false, aw.finalsMvp.teamId,
      body3('award', key('fmvp'), `${pName(aw.finalsMvp.playerId)}이(가) 챔피언결정전 최우수선수로 뽑혔다. 가장 큰 무대에서 가장 빛났다.`), aw.finalsMvp.playerId);
    if (aw.rookie) push(a.season, 'award', vh([
      (n) => `신인상 — ${n} (${teamName(aw.rookie!.teamId)})`,
      (n) => `다음 세대의 얼굴, ${n}`,
    ], key('rook'), pName(aw.rookie.playerId)), false, aw.rookie.teamId,
      body3('award', key('rook'), `${pName(aw.rookie.playerId)}(${teamName(aw.rookie.teamId)})이(가) ${S}시즌 신인상을 받았다. 데뷔 시즌부터 코트에서 존재감을 보였다.`), aw.rookie.playerId);
    if (aw.mostImproved) push(a.season, 'award', vh([
      (n) => `기량발전상 — ${n}`,
      (n) => `가장 크게 성장한 선수, ${n}`,
    ], key('imp'), pName(aw.mostImproved.playerId)), false, aw.mostImproved.teamId,
      body3('award', key('imp'), `${pName(aw.mostImproved.playerId)}이(가) ${S}시즌 기량발전상의 주인공이 됐다. 지난 시즌 대비 가장 크게 성장했다.`), aw.mostImproved.playerId);

    // ── 득점왕(마퀴) + 부문 기록왕 5종(통합 1건) ──
    if (aw.titles.scoring) push(a.season, 'award', vh([
      (n) => `득점왕 — ${n} ${aw.titles.scoring!.value}점`,
      (n) => `${S}시즌 최다 득점, ${n}`,
      (n) => `'${aw.titles.scoring!.value}점' ${n}, ${S}시즌 득점왕`,
    ], key('score'), pName(aw.titles.scoring.playerId)), false, aw.titles.scoring.teamId,
      body3('king', key('score'), `${pName(aw.titles.scoring.playerId)}이(가) 통산 ${aw.titles.scoring.value}점으로 ${S}시즌 득점 1위에 올랐다. 한 시즌 내내 팀 공격을 책임졌다.`), aw.titles.scoring.playerId);
    const subKings = SUB_TITLES.map((k) => ({ k, w: aw.titles[k] })).filter((x) => x.w);
    if (subKings.length) {
      const list = subKings.map((x) => `${TITLE_KO[x.k]} ${pName(x.w!.playerId)}(${x.w!.value}${TITLE_UNIT[x.k]})`).join(', ');
      push(a.season, 'award', `${S}시즌 부문 기록왕 — ${subKings.length}개 부문`, false, undefined,
        body3('king', key('subk'), `${S}시즌 부문별 1위가 가려졌다. ${list}.`));
    }

    // ── 베스트7 ──
    const b7 = (aw.best7 ?? []).filter((s) => s.winner);
    if (b7.length) {
      const names = b7.sort((x, y) => BEST7_ORDER.indexOf(x.pos) - BEST7_ORDER.indexOf(y.pos))
        .map((s) => `${POS_KO[s.pos] ?? s.pos} ${pName(s.winner!.playerId)}`).join(' · ');
      const mineCnt = b7.filter((s) => s.winner!.teamId === myTeamId).length;
      push(a.season, 'award', `${S}시즌 베스트7 발표`, mineCnt >= 3, mineCnt > 0 ? myTeamId : undefined,
        body3('best7', key('b7'), `${S}시즌 베스트7이 발표됐다. ${names}.` + (mineCnt >= 2 ? ` ${teamName(myTeamId)}에서만 ${mineCnt}명이 이름을 올렸다.` : '')));
    }

    // ── 라운드 MVP(통합 1건) ──
    const rms = (aw.roundMvps ?? []).map((w, i) => ({ w, i })).filter((x) => x.w);
    if (rms.length) {
      const list = rms.map((x) => `${x.i + 1}R ${pName(x.w!.playerId)}`).join(', ');
      push(a.season, 'award', `${S}시즌 라운드별 MVP`, false, undefined,
        body3('award', key('rmvp'), `${S}시즌 라운드를 지배한 선수들이 가려졌다. ${list}.`));
    }

    // ── 순위 서사(최종 순위) ──
    if (a.standings && a.standings.length) {
      const teams = a.standings.length;
      const myRank = a.standings.indexOf(myTeamId) + 1;
      if (myRank === 2) push(a.season, 'standing', `${teamName(myTeamId)}, ${S}시즌 정규리그 2위`, false, myTeamId,
        body3('standing', key('rank2'), `${teamName(myTeamId)}이(가) ${S}시즌 정규리그를 2위로 마쳤다. 정상을 눈앞에 두고 아쉽게 한 걸음이 모자랐다.`));
      else if (myRank === teams && teams > 0) push(a.season, 'standing', `${teamName(myTeamId)}, ${S}시즌 최하위`, false, myTeamId,
        body3('standing', key('last'), `${teamName(myTeamId)}이(가) ${S}시즌 정규리그 최하위에 머물렀다. 반등을 위한 긴 겨울이 시작됐다.`));
    }

    // ── 시즌 기록(전승·30승·무승) — 어느 팀이든 ──
    if (a.record) {
      for (const [tid, rec] of Object.entries(a.record)) {
        const [w, l] = rec;
        if (w + l <= 0) continue;
        if (l === 0) push(a.season, 'standing', `${teamName(tid)}, ${S}시즌 정규리그 전승`, true, tid,
          body3('standing', `${a.season}:perf:${tid}`, `${teamName(tid)}이(가) ${S}시즌 정규리그를 ${w}승 무패, 단 한 번도 지지 않고 마쳤다. 압도적인 한 해였다.`));
        else if (w === 0) push(a.season, 'standing', `${teamName(tid)}, ${S}시즌 무승의 굴욕`, true, tid,
          body3('standing', `${a.season}:winless:${tid}`, `${teamName(tid)}이(가) ${S}시즌 ${l}패를 떠안으며 단 1승도 거두지 못했다. 시즌 전체를 다시 설계해야 하는 처지다.`));
        else if (w >= 30) push(a.season, 'standing', `${teamName(tid)}, ${S}시즌 ${w}승 — 압도적 시즌`, false, tid,
          body3('standing', `${a.season}:big:${tid}`, `${teamName(tid)}이(가) ${S}시즌 ${w}승(${l}패)으로 리그를 압도했다. 30승 고지를 넘은 시즌이다.`));
      }
    }

    // ── 연승·연패 서사 — 그 시즌 리그 최장만(노이즈 방지) ──
    if (a.streaks) {
      let bestWin = { tid: '', n: 0 }, bestLose = { tid: '', n: 0 };
      for (const [tid, s] of Object.entries(a.streaks)) {
        if (s[0] > bestWin.n) bestWin = { tid, n: s[0] };
        if (s[1] > bestLose.n) bestLose = { tid, n: s[1] };
      }
      if (bestWin.n >= 8) push(a.season, 'streak', vh([
        (t) => `${t}, ${S}시즌 ${bestWin.n}연승 질주`,
        (t) => `${bestWin.n}연승 파죽지세 — ${t}`,
      ], `${a.season}:win`, teamName(bestWin.tid)), bestWin.n >= 12, bestWin.tid,
        body3('streakWin', `${a.season}:win`, `${teamName(bestWin.tid)}이(가) ${S}시즌 한때 ${bestWin.n}연승을 내달렸다.`));
      if (bestLose.n >= 8) push(a.season, 'streak', vh([
        (t) => `${t}, ${S}시즌 ${bestLose.n}연패 수렁`,
        (t) => `${bestLose.n}연패 악몽 — ${t}`,
      ], `${a.season}:lose`, teamName(bestLose.tid)), bestLose.n >= 12, bestLose.tid,
        body3('streakLose', `${a.season}:lose`, `${teamName(bestLose.tid)}이(가) ${S}시즌 ${bestLose.n}연패의 긴 터널을 지났다.`));
    }
  }

  // 2) 마일스톤(기록 경신)
  for (const m of milestones) push(m.season, 'milestone', m.text, m.big, m.teamId,
    body3('milestone', `${m.season}:ms:${m.playerId}:${m.text}`,
      `${m.text} ${m.kind === 'league' ? '리그 역사에' : m.kind === 'club' ? '구단 역사에' : '개인 통산 기록에'} 새로 새겨졌다.`), m.playerId);

  // 3) 명예의전당 헌액
  for (const h of hallOfFame) {
    const key = `${h.retiredSeason}:hof:${h.id}`;
    push(h.retiredSeason, 'hof', vh([
      (n) => `${n}, 명예의전당 헌액${h.legend ? ' · 영구결번' : ''} (통산 ${h.points.toLocaleString()}점)`,
      (n) => `전설의 마침표 — ${n} 명예의전당으로`,
    ], key, h.name), h.legend, h.teamId,
      body3('hof', key, `${h.name}이(가) ${h.seasons}시즌의 커리어를 마치고 명예의전당에 헌액됐다. ${teamName(h.teamId)}에서 통산 ${h.points.toLocaleString()}점·블로킹 ${h.blocks.toLocaleString()}개·디그 ${h.digs.toLocaleString()}개를 남겼다.`
        + (h.legend ? ' 구단은 등번호를 영구결번으로 올렸다.' : '')), h.id);
  }

  // 4) 이번 시즌 큰 부상(중상·시즌아웃만 — 경미는 단신 제외)
  for (const s of seasonInjuryReport()) {
    if (s.severity !== 'major' && s.severity !== 'season') continue;
    const out = s.severity === 'season' ? '시즌아웃' : `약 ${s.missMatches}경기 결장`;
    const key = `${currentSeason}:inj:${s.playerId}`;
    push(currentSeason, 'injury', `${pName(s.playerId)} ${SEVERITY_KO[s.severity]} — ${out}`, s.severity === 'season', s.teamId,
      body3('injury', key, `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SEVERITY_KO[s.severity]} 판정을 받아 ${out}이(가) 예상된다. ${teamName(s.teamId)}은(는) 당분간 ${posKoOf(s.playerId)} 자리를 메워야 한다.`), s.playerId);
  }

  // 5) 사건·사고 — 아주 가끔, 리그를 뒤흔드는 헤드라인
  for (const s of seasonScandals()) {
    push(currentSeason, 'scandal', `[단독] ${pName(s.playerId)}(${teamName(s.teamId)}), ${SCANDAL_KO[s.kind]} — ${s.missMatches}경기 출장 정지`, true, s.teamId,
      body3('scandal', `${currentSeason}:sc:${s.playerId}`, `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SCANDAL_KO[s.kind]}으로 ${s.missMatches}경기 출장 정지 징계를 받았다.`), s.playerId);
  }

  // 6) 영구제명 — 리그를 뒤흔드는 최대 사건(승부조작·학폭). 영속 기록에서.
  for (const e of expelled) {
    push(e.season, 'scandal', `[속보] ${e.name}(${teamName(e.teamId)}), ${EXPEL_KO[e.kind]} 적발 — 영구제명(리그 영구 퇴출)`, true, e.teamId,
      body3('scandal', `${e.season}:ex:${e.playerId}`, `${e.name}(${teamName(e.teamId)})이(가) ${EXPEL_KO[e.kind]}으로 적발돼 리그에서 영구제명됐다. 코트로 돌아올 수 없으며, 그의 이름은 불명예 기록으로만 남는다.`), e.playerId);
  }

  // 7) 구단주 — 인기 스타를 벤치로 보낸 건의가 받아들여졌을 때 팬심이 술렁(OWNER_SYSTEM 팬 분노 연동)
  for (const b of benchDirectives) {
    const p = getPlayer(b.playerId); if (!p) continue;
    const pop = popularityNow(p, currentDay, archive);
    if (pop < 60) continue; // 인기 스타만 — 무명 선수 벤치는 기사 안 남
    push(currentSeason, 'owner', `팬들, 간판 ${p.name} 벤치 기용에 술렁 — "왜 안 쓰나"`, pop >= 78, myTeamId,
      body3('owner', `${currentSeason}:own:${b.playerId}`, `${teamName(myTeamId)}의 간판 ${p.name}이(가) 최근 출전 명단에서 빠지면서 팬들이 술렁이고 있다. "왜 안 쓰나"라는 목소리가 커지고 있다.`), b.playerId);
  }

  return items.sort((x, y) => y.season - x.season || Number(y.big) - Number(x.big));
}

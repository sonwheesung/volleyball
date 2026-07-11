// 뉴스 피드 (NEWS_SYSTEM, 캡스톤). 자동 진행된 리그를 읽을 수 있는 기사로.
// ★ 새 저장 없음 — archive(시상·순위·연승·플옵)·milestones·hallOfFame·injuries 에서 순수 파생(결정론).
//   가짜 드라마 금지: 기록에 근거한 사실만. 중요도(big)로 헤드라인/단신 구분.
//   본문은 조립식(opener+사실+closer) + 안정 시드 변주 → 같은 종류라도 표현이 다르다(NEWS_SYSTEM §4).

import type { DraftPickRecord, ExpelRecord, ForeignSwapRecord, HofEntry, Milestone, NewsItem, RetireRecord, SeasonArchive, SeasonAwards, Transfer } from '../types';
import type { BenchDirective } from '../engine/owner';
import { getPlayer, getTeam, reconstructForeignName } from './league';
import { jerseyNumber } from '../engine/jersey';
import { RETIRE_AGE } from '../engine/retire';
import { formatMoney } from '../engine/salary';
import { ALL_POSITIONS } from '../engine/overall';
import { prospectArcRetro } from './seed';
import { numberLineage } from './legends';
import { topFriendOnTeam } from './relationships';
import { popularityNow } from './owner';
import { seasonInjuryReport } from './injury';
import { seasonMatchProds } from './production';
import { SEVERITY_KO } from '../engine/injury';
import { seasonScandals } from './dynamics';
import { seasonClinchTransitions } from './clinch';
import { buildPlayoffs } from './playoffs';
import { postseasonReveal } from './postseason';
import { PO_SLOTS, FINAL_SLOTS, SEASON_DAYS } from '../engine/calendar';
import { SCANDAL_KO, EXPEL_KO } from '../engine/scandal';
import { resolveJosa, josa } from '../lib/josa';
import { sponsorStanceOf } from '../engine/sponsorStance';

const teamName = (id: string) => getTeam(id)?.name ?? id;
const pName = (id: string) => getPlayer(id)?.name ?? reconstructForeignName(id) ?? id;
const POS_KO: Record<string, string> = { S: '세터', OH: '아웃사이드 히터', OP: '아포짓', MB: '미들 블로커', L: '리베로' };
const posKoOf = (id: string) => POS_KO[getPlayer(id)?.position ?? ''] ?? '주전';
/** 선수 통산 사실 한 줄(포지션별 대표 스탯) — 본문 보강용. 은퇴/조회 불가 시 빈 문자열. 전부 실제 누적값(가짜 드라마 금지). */
const careerLine = (playerId: string): string => {
  const p = getPlayer(playerId); const c = p?.career;
  if (!p || !c || c.matches <= 0) return '';
  const stat = p.position === 'L' ? `디그 ${c.digs.toLocaleString()}개`
    : p.position === 'S' ? `세트 어시스트 ${c.assists.toLocaleString()}개`
    : p.position === 'MB' ? `블로킹 ${c.blocks.toLocaleString()}개`
    : `${c.points.toLocaleString()}점`;
  return `${POS_KO[p.position]} ${p.name}의 통산 성적은 ${c.seasons}시즌 ${c.matches}경기 ${stat}이다.`;
};
/** core 뒤에 사실 절을 덧붙임(빈 문자열이면 그대로) — 본문 보강 공통. */
const more = (core: string, ...facts: string[]): string => [core, ...facts.filter((f) => f && f.trim())].join(' ');

/** 뉴스 안정 키(§4.4 Step0) — season:kind:kord. kord = (season:kind)당 결정론 순번(문구 무관).
 *  헤드라인·ref 제외 → 문구를 바꿔도(Step1~3) 읽음추적 불변, 한 선수 다건도 순번이라 충돌 0.
 *  내용 중복 검사는 별도 contentKey 사용(simNews). */
export const newsKey = (n: NewsItem) => `${n.season}:${n.kind}:${n.kord ?? n.ref ?? ''}`;
/** 내용 중복(같은 기사 두 번 방출 버그) 검출용 — 순번 무관, 실제 문구 비교. simNews/가드 전용. */
export const newsContentKey = (n: NewsItem) => `${n.season}:${n.kind}:${n.headline}:${n.body ?? ''}`;

// ─── 변주 엔진 (NEWS_SYSTEM §4.2) ─────────────────────────────
// 안정 시드 해시(FNV-1a). 같은 키 → 같은 변형(리플레이 일치), 다른 기사 → 다른 변형.
const hashStr = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  // murmur3 fmix 마무리(§4.4) — FNV-1a는 하위비트 애벌런치가 약해 `%4`(2의 거듭제곱)가 버킷 2개만 써서
  // 4개 풀이 사실상 2개로 붕괴했다(측정: template%4 분포 [0,2455,0,1545]). fmix로 하위비트까지 균등 혼합.
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
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
    close: ['통산 기록은 리그에 영구히 남는다.', '그 발자취는 후배들의 이정표가 된다.', '은퇴는 끝이 아니라 또 다른 기록의 시작이다.', '코트를 떠나도 이름은 전당에 영원히 걸린다.'],
  },
  retire: {
    open: ['긴 여정의 마침표가 찍혔다.', '한 베테랑이 코트와 작별한다.', '오랜 시간 코트를 지킨 이름이 떠난다.', '한 시대를 함께한 선수가 유니폼을 벗는다.'],
    close: ['수고했다는 말로는 부족한 세월이었다.', '팬들은 그 마지막 시즌을 오래 기억할 것이다.', '코트를 떠나도 쌓아온 기록은 남는다.', '다음 세대가 그 빈자리를 채워갈 것이다.'],
  },
  injury: {
    open: ['반갑지 않은 소식이다.', '팀에 전력 공백이 생겼다.', '코트 밖 변수가 순위에 끼어들었다.'],
    close: ['복귀 시점이 시즌 후반의 변수가 된다.', '백업 자원의 분발이 필요해졌다.', '팀은 로테이션 조정으로 공백을 메워야 한다.'],
  },
  scandal: {
    open: ['리그를 뒤흔든 소식이다.', '코트 밖에서 터진 사건이다.', '예상치 못한 후폭풍이 일었다.'],
    close: ['구단과 리그는 후속 조치를 검토 중이다.', '팀은 핵심 자원을 잃은 채 일정을 소화하게 됐다.', '여파는 시즌 내내 이어질 전망이다.'],
  },
  playoff: {
    open: ['봄배구의 열기가 코트를 달궜다.', '한 경기가 시즌의 무게를 짊어졌다.', '단기전의 긴장감이 그대로 전해졌다.', '가을부터 달려온 여정의 끝자락이다.'],
    close: ['시리즈의 향방이 점점 또렷해진다.', '다음 경기에 더 큰 무게가 실린다.', '봄배구는 한 경기 한 경기가 역사가 된다.', '단기전엔 내일이 없다.'],
  },
  owner: {
    open: ['관중석이 술렁였다.', '팬심이 출렁인 한 장면이다.', '코트 밖 여론이 움직였다.'],
    close: ['구단 운영은 성적만큼이나 정서도 살펴야 한다.', '팬과 구단 사이의 거리가 시험대에 올랐다.', '여론의 향배가 다음 행보에 영향을 줄 전망이다.'],
  },
  triple: {
    open: ['경기를 지배한 자에게만 허락되는 왕관이다.', '한 경기에서 세 부문을 동시에 폭발시켰다.', '좀처럼 보기 힘든 대기록이 나왔다.'],
    close: ['트리플 크라운은 코트를 완전히 장악했다는 증표다.', '공·수·서브 전 영역에서 존재감을 뽐낸 한 경기였다.', '시즌을 통틀어 손에 꼽을 장면으로 남았다.'],
  },
  debut: {
    open: ['새 얼굴이 코트에 첫발을 디뎠다.', '기다리던 데뷔 무대가 열렸다.', '미래의 주인공이 첫 선발 명단에 이름을 올렸다.'],
    close: ['데뷔전의 기록은 긴 커리어의 출발점이 된다.', '첫 무대의 떨림을 코트 위 활약으로 갚았다.', '다음 세대의 성장 곡선이 여기서 시작된다.'],
  },
  biggame: {
    open: ['한 경기를 통째로 끌고 갔다.', '폭발적인 한 경기였다.', '코트의 중심에 선 하루였다.'],
    close: ['이런 경기가 팀의 순위 싸움을 떠받친다.', '에이스의 무게를 숫자로 증명했다.', '시즌 베스트 게임으로 손꼽힐 활약이었다.'],
  },
  transfer: {
    open: ['오프시즌 시장이 움직였다.', '한 선수의 거취가 정해졌다.', '새 유니폼을 입는다.', 'FA 시장의 한 페이지가 넘어갔다.'],
    close: ['새 팀에서의 활약이 기대된다.', '이적이 두 팀의 전력 균형을 흔든다.', '한 시즌의 새 출발이다.', '익숙한 코트를 떠나 새 도전을 시작한다.'],
  },
  release: { // 방출/재계약 불발 — transfer 낙관 톤과 분리(2026-06-25 에디터)
    open: ['방출 명단에 이름이 올랐다.', '한 시즌의 인연이 정리됐다.', '냉정한 전력 구상의 결과다.', 'FA 시장에 새 이름이 나왔다.'],
    close: ['새 팀을 찾아야 하는 처지가 됐다.', '거취는 아직 안갯속이다.', '반등의 무대를 스스로 찾아야 한다.', '한 시즌의 마침표이자 새 출발선이다.'],
  },
  sponsorAggr: { // 모기업 큰손 등판 예고(FINANCE 2.0 Stage2b) — 소문 톤·불발 가능
    open: ['구단 안팎에서 큰손 등판설이 흘러나온다.', '모기업이 지갑을 열 채비라는 말이 돈다.', 'FA 시장을 앞두고 공격적 영입 기류가 감지된다.', '오프시즌을 앞두고 분위기가 심상치 않다.'],
    close: ['다만 영입은 상대가 있는 일, 뜻대로 될지는 미지수다.', '실제 영입으로 이어질지는 시장이 열려봐야 안다.', '소문이 현실이 될지 시선이 쏠린다.', '거물 쟁탈전의 한 축이 될 전망이다.'],
  },
  offseason: { // 오프시즌 결산 종합(§3.7) — 내 팀 개막 진용 브리핑
    open: ['새 시즌을 앞두고 진용이 정리됐다.', '오프시즌의 선수 이동이 마무리됐다.', '개막을 앞두고 스쿼드가 확정됐다.', '겨울 동안의 전력 재편이 끝났다.'],
    close: ['새 시즌의 출발선이 정해졌다.', '완성된 스쿼드로 개막을 맞는다.', '이제 코트에서 답을 낼 차례다.', '한 시즌의 밑그림이 그려졌다.'],
  },
  quietOff: { // 조용한 오프시즌(변동 0) — 관망 톤(리브니스: 변동 없어도 항상 한 건)
    open: ['이번 겨울은 조용했다.', '큰 움직임 없는 오프시즌이었다.', '전력의 큰 변화 없이 겨울이 지났다.', '영입도 유출도 눈에 띄지 않았다.'],
    close: ['익숙한 얼굴들로 새 시즌을 맞는다.', '기존 전력의 조직력에 기대를 건다.', '변화보다 지속을 택한 겨울이다.', '손발을 맞춰온 스쿼드 그대로 개막에 나선다.'],
  },
  draft: { // 드래프트 입단 개별(§3.7) — 안개 원칙(포지션·순번만, 정확 OVR 없음)
    open: ['미래의 자원이 새 유니폼을 입는다.', '신인 드래프트가 한 이름을 호명했다.', '다음 세대의 씨앗이 뿌려졌다.', '한 팀의 미래가 지명으로 정해졌다.'],
    close: ['잠재력은 이제 코트에서 확인될 것이다.', '성장 곡선은 데뷔 이후 그려진다.', '기대주의 첫 페이지가 열렸다.', '이름값은 앞으로 경기가 증명한다.'],
  },
  foreign: { // 외인·아시아쿼터 교체 개별(§3.7) — 리그 가시(전 팀)
    open: ['외국인 선수 시장이 움직였다.', '외인 자리의 주인이 바뀌었다.', '새 외국인 카드가 공개됐다.', '팀 공격의 핵이 교체됐다.'],
    close: ['외국인 선수 하나가 시즌 성패를 좌우한다.', '새 얼굴의 활약에 시즌이 걸렸다.', '외인 결정은 늘 가장 큰 도박이다.', '코트에서의 증명만 남았다.'],
  },
  sponsorThrift: { // 모기업 긴축·관망 예고(FINANCE 2.0 Stage2b)
    open: ['모기업이 허리띠를 졸라맨다는 말이 나온다.', '이번 오프시즌은 관망 기조라는 기류다.', '큰 영입보다 내실을 다질 분위기다.', '지갑을 닫을 것이라는 전망이 우세하다.'],
    close: ['FA 시장에서 조용한 행보가 예상된다.', '실속형 운영으로 시즌을 준비할 전망이다.', '큰 변화보다 기존 전력 유지에 무게가 실린다.', '시장이 열려봐야 알겠지만 움직임은 크지 않을 듯하다.'],
  },
  clinchTitle: { // 정규리그 1위(챔프전 직행) 확정 — 최고 영예, 골드 톤(§3.1)
    open: ['정규리그의 왕좌가 주인을 찾았다.', '길고 치열했던 선두 다툼이 끝났다.', '레이스의 정점에 한 팀이 우뚝 섰다.'],
    close: ['챔피언결정전 직행 티켓이 손에 들어왔다.', '정규리그 1위의 프리미엄을 안고 봄배구를 기다린다.', '남은 건 왕좌를 향한 마지막 한 걸음이다.'],
  },
  clinchPo: { // 포스트시즌(봄배구) 진출 확정 — 안도와 기대
    open: ['봄배구로 가는 문이 열렸다.', '가을부터 달려온 여정이 결실을 맺었다.', '포스트시즌 진출이 수학적으로 굳어졌다.'],
    close: ['이제 더 높은 곳을 바라본다.', '단기전을 향한 채비가 시작됐다.', '정규리그 마지막까지 순위 싸움은 계속된다.'],
  },
  clinchElim: { // 포스트시즌 탈락 확정 — 담담한 톤(축포 금지)
    open: ['봄배구의 문이 닫혔다.', '포스트시즌 경쟁에서 한발 물러섰다.', '다음 가을을 기약하게 됐다.'],
    close: ['남은 일정은 다음 시즌을 위한 실험대가 된다.', '아쉬움을 뒤로하고 긴 겨울을 준비한다.', '반등의 청사진이 필요한 겨울이 왔다.'],
  },
};

const TITLE_KO: Record<string, string> = {
  scoring: '득점', spike: '공격 성공', block: '블로킹', serve: '서브', dig: '디그', set: '세트(어시스트)', receive: '리시브',
};
const TITLE_UNIT: Record<string, string> = { scoring: '점', spike: '개', block: '개', serve: '개', dig: '개', set: '개', receive: '개' };
const SUB_TITLES: (keyof SeasonAwards['titles'])[] = ['spike', 'block', 'serve', 'dig', 'set', 'receive'];
const BEST7_ORDER = ALL_POSITIONS; // 포지션 표시순(= 전 포지션 고정순) 단일 출처

/** 전체 뉴스 피드(최신 시즌 우선, 같은 시즌 내 헤드라인 우선) */
export function buildNewsFeed(
  archive: SeasonArchive[],
  milestones: Milestone[],
  hallOfFame: HofEntry[],
  currentSeason: number,
  expelled: ExpelRecord[] = [],
  benchDirectives: BenchDirective[] = [], // 구단주 벤치 지시(내 팀, 현재 시즌) — 인기 스타 벤치 → 팬 술렁
  leagueDay = 0, // 리그 진행 컷오프 = leagueDisplayDay(currentDay) = currentDay−1 (관전/미래 경기·사건 제외, NEWS_SYSTEM §3.5). 호출부가 leagueDisplayDay를 넘긴다 — raw currentDay 금지(첫 경기 전 스포일러).
  myTeamId = '',
  transfers: Transfer[] = [], // FA 이적 연표(슬라이스3) — 내 팀 in/out만 기사화
  retirements: RetireRecord[] = [], // 은퇴 연표(슬라이스5) — 주목 은퇴자 작별·회고
  seasonDraftLog: DraftPickRecord[] = [], // 드래프트 입단 연표(슬라이스6, §3.7) — 오프시즌 결산 개막 뉴스
  seasonForeignLog: ForeignSwapRecord[] = [], // 외인·아시아쿼터 교체 연표(슬라이스6, §3.7)
  poDay = leagueDay, // 포스트시즌 컷오프 트랙(§5.2 달력 편입) = raw currentDay. 치른(공개) 플옵 경기까지만 기사화 —
                     //   leagueDay(displayCutoff)는 시즌완료 시 164로 클램프돼 플옵 진행을 못 보므로 별도 트랙. 기본=leagueDay(구 호출 무변).
): NewsItem[] {
  const items: NewsItem[] = [];
  // 뉴스 안정 키(Step0, §4.4): ref = (season:kind)당 결정론 순번(ordinal). 문구 무관 → Step1~3에서
  // 헤드라인/본문 문구를 바꿔도 읽음추적 키가 불변(백카탈로그가 미읽음으로 재등장하지 않음).
  // 명시 ref를 주면 그걸 우선(엔티티 앵커). 기사 SET/push 순서는 사실로 결정 → 버전 내 결정론.
  const kindOrd = new Map<string, number>();
  // 조사 병기("코메츠이(가)") 일괄 교정 — 헤드라인·본문 전체에 받침 기준 적용(NEWS_SYSTEM §4.5).
  const push = (season: number, kind: NewsItem['kind'], headline: string, big: boolean, teamId?: string, body?: string, ref?: string, day?: number) => {
    // kord = (season:kind)당 결정론 순번 → 읽음키(newsKey) 기반. ref(엔티티 앵커, 이적 게이트용)와 분리해
    // 한 선수가 시즌에 여러 기사(밀스톤 2개·트리플+폭발 등)를 받아도 읽음키가 충돌하지 않는다(§4.4 Step0).
    // day = 발생 전역일(현재 시즌 인게임만) → 최신순 정렬·2주 만료(§9). 시즌요약(과거)은 undefined.
    const ok = `${season}:${kind}`;
    const ord = kindOrd.get(ok) ?? 0;
    kindOrd.set(ok, ord + 1);
    items.push({ season, kind, headline: resolveJosa(headline), big, teamId, body: body ? resolveJosa(body) : body, ref, kord: String(ord), day });
  };

  // ── Step1 fact-hook 파생층(§4.4) — archive 스캔으로 "사실"을 만든다(문구 아님). Step2 core가 전제조건으로 골라 씀.
  //   연패(왕조): archive 내 직전 시즌도 같은 팀 우승 = 참(구단 사전이력과 무관하게 관측 사실이라 가짜드라마 아님).
  //   ⚠ "구단 첫 우승"·"통산 N번째"는 여기서 만들지 않는다 — 클럽은 게임 시작 전 우승수(clubIdentity.titles: 명문7·황혼5…,
  //   표시전용)를 이미 갖고 archive는 플레이한 시즌만 담아, archive-only 카운트로 "첫/통산"을 주장하면 명문·황혼팀에 거짓.
  //   안전히 하려면 클럽 시작 titles를 buildNewsFeed로 배선해야 함(배선 전까지 보류 — 프레이밍 가짜드라마 회피).
  const champSeasonsBy = new Map<string, number[]>();
  for (const a of archive) if (a.championId) { const arr = champSeasonsBy.get(a.championId); if (arr) arr.push(a.season); else champSeasonsBy.set(a.championId, [a.season]); }
  const dynastyRun = (teamId: string, season: number): number => {
    const ss = champSeasonsBy.get(teamId) ?? []; const idx = ss.indexOf(season); if (idx < 0) return 1;
    let run = 1; for (let i = idx; i > 0 && ss[i] === ss[i - 1] + 1; i--) run++; return run; // 관측된 연속 우승 시즌 수
  };

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
      const run = dynastyRun(a.championId, a.season); // 관측된 연속 우승 시즌 수(왕조)
      const tag = reverse ? ' — 리버스 스윕 대역전' : sweep ? ' — 3-0 스윕' : run >= 2 ? ` — ${run}연패` : '';
      const core = `${teamName(a.championId)}이(가) ${S}시즌 정상에 올랐다.`
        + (reverse ? ' 챔피언결정전에서 2패 뒤 3연승, 리버스 스윕의 대역전 우승이었다.' : sweep ? ' 챔피언결정전을 3-0 스윕으로 끝낸 완벽한 대관식이었다.' : '')
        + (run >= 3 ? ` ${run}시즌 연속 우승 — 리그를 지배하는 왕조의 시대다.` : run === 2 ? ' 2연패에 성공하며 왕조의 발판을 놓았다.' : '') // 연패는 archive 관측 사실(가짜드라마 아님)
        + (aw?.mvp && aw.mvp.teamId === a.championId ? ` 정규리그 MVP ${pName(aw.mvp.playerId)}을(를) 앞세웠다.` : '') // 우승팀 소속일 때만(타팀 MVP를 "앞세웠다"는 가짜드라마 — 독립리뷰 2026-07-01)
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
      else if (myRank === teams && teams > 0) {
        const rec = a.record?.[myTeamId];
        const wl = rec ? `${rec[0]}승 ${rec[1]}패, ` : '';
        const note = vp([
          '반등을 위한 긴 겨울이 시작됐다.',
          '바닥에서 다시 쌓아 올려야 하는 시즌이 됐다.',
          '리빌딩의 청사진이 절실해졌다.',
          '다음 시즌을 향한 대수술이 불가피해졌다.',
          '자존심을 회복할 반격의 동력이 필요하다.',
        ], key('last'), 3);
        push(a.season, 'standing', `${teamName(myTeamId)}, ${S}시즌 최하위(${teams}팀 중 꼴찌)`, false, myTeamId,
          body3('standing', key('last'), `${teamName(myTeamId)}이(가) ${wl}${S}시즌 정규리그 최하위에 머물렀다. ${note}`));
      }
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
        body3('streakWin', `${a.season}:win`, more(`${teamName(bestWin.tid)}이(가) ${S}시즌 한때 ${bestWin.n}연승을 내달렸다.`,
          a.record?.[bestWin.tid] ? `그 시즌을 ${a.record[bestWin.tid][0]}승 ${a.record[bestWin.tid][1]}패로 마쳤고, 연승은 순위 싸움의 분수령이 됐다.` : '')));
      if (bestLose.n >= 8) push(a.season, 'streak', vh([
        (t) => `${t}, ${S}시즌 ${bestLose.n}연패 수렁`,
        (t) => `${bestLose.n}연패 악몽 — ${t}`,
      ], `${a.season}:lose`, teamName(bestLose.tid)), bestLose.n >= 12, bestLose.tid,
        body3('streakLose', `${a.season}:lose`, more(`${teamName(bestLose.tid)}이(가) ${S}시즌 ${bestLose.n}연패의 긴 터널을 지났다.`,
          a.record?.[bestLose.tid] ? `최종 성적은 ${a.record[bestLose.tid][0]}승 ${a.record[bestLose.tid][1]}패, 긴 부진이 시즌을 흔들었다.` : '')));
    }
  }

  // 2) 마일스톤(기록 경신) — 헤드라인(m.text)이 사실(수치)을 말하므로 본문은 맥락만(재탕·수치 모순 방지, 2026-06-25 에디터).
  // 저신호 장수(routine·non-big "현역 롱런")는 피드서 생략(연표엔 남음) — 우승/시상 같은 고신호 묻힘 방지(NEWS §4.6). 시즌당 비-big 상한.
  const msCapBySeason = new Map<number, number>();
  const MS_CAP = 8; // 시즌당 비-big 마일스톤 뉴스 상한(big은 무제한 — 헤드라인 우선)
  for (const m of milestones) {
    if (m.routine && !m.big) continue;
    if (!m.big) {
      const n = msCapBySeason.get(m.season) ?? 0;
      if (n >= MS_CAP) continue;
      msCapBySeason.set(m.season, n + 1);
    }
    const kindKo = m.kind === 'league' ? '리그 역대 기록' : m.kind === 'club' ? '구단 통산 기록' : '개인 통산 기록';
    const sig = m.big ? '리그가 주목할 이정표다.' : '오랜 꾸준함이 쌓아 올린 한 걸음이다.';
    const msKey = `${m.season}:ms:${m.playerId}:${m.text}`;
    // core 프레임을 키로 회전(§4.4 Step2) — 수치는 헤드라인(m.text)이 말하므로 본문은 문구만 변주(재탕·볼륨 증가 금지).
    // 같은 선수·같은 카테고리라도 m.text(임계)가 달라 키가 달라짐 → 프레임+open/close 조합으로 본문 중복 급감.
    const msCore = vp([
      `${teamName(m.teamId)} 소속 ${m.name}이(가) ${kindKo}에 또 하나의 이정표를 새겼다.`,
      `${m.name}(${teamName(m.teamId)})의 커리어가 ${kindKo}에 새 획을 그었다.`,
      `${teamName(m.teamId)}의 ${m.name}, ${kindKo}에 또렷한 발자취를 남겼다.`,
      `${m.name}이(가) ${kindKo}에서 커리어의 한 칸을 더 채웠다.`,
    ], msKey, 3); // salt 3 — open(1)·close(2)와 독립 스트림
    push(m.season, 'milestone', m.text, m.big, m.teamId, body3('milestone', msKey, `${msCore} ${sig}`), m.playerId);
  }

  // 3) 명예의전당 헌액
  for (const h of hallOfFame) {
    const key = `${h.retiredSeason}:hof:${h.id}`;
    // 0인 스탯은 빼고 나열(공격수 "디그 0개"·리베로 "블로킹 0개" 박제 방지, 2026-06-25 에디터)
    const hofStats = [
      h.points > 0 ? `통산 ${h.points.toLocaleString()}점` : '',
      h.blocks > 0 ? `블로킹 ${h.blocks.toLocaleString()}개` : '',
      h.digs > 0 ? `디그 ${h.digs.toLocaleString()}개` : '',
    ].filter(Boolean).join('·');
    // 헌액 번호(비소모·결정론) + 번호 계보(사실만 — '계승' 인과 금지, docs/BROADCAST §8.3)
    const num = jerseyNumber(h.id);
    const lineage = h.legend ? numberLineage(hallOfFame, h.teamId, num, h.id, h.retiredSeason) : [];
    const legacyTxt = lineage.length > 0
      ? ` 같은 ${num}번을 달았던 과거 레전드 — ${lineage.map((g) => `${g.name}(통산 ${g.points.toLocaleString()}점)`).join(', ')}.`
      : '';
    push(h.retiredSeason, 'hof', vh([
      (n) => `${n}, 명예의전당 헌액${h.legend ? ` · 헌액 번호 ${num}번` : ''} (통산 ${h.points.toLocaleString()}점)`,
      (n) => `전설의 마침표 — ${n} 명예의전당으로`,
    ], key, h.name), h.legend, h.teamId,
      body3('hof', key, `${h.name}이(가) ${h.seasons}시즌의 커리어를 마치고 명예의전당에 헌액됐다.${hofStats ? ` ${teamName(h.teamId)}에서 ${hofStats}를 남겼다.` : ''}`
        + (h.legend ? ` 구단은 헌액 번호 ${num}번을 전당에 새겼다.${legacyTxt}` : '')), h.id);
  }

  // 3.5) 은퇴 세리머니(슬라이스5) — 주목 은퇴자 작별 + 커리어 회고. HOF 헌액과 상보(작별 vs 전당 입성).
  for (const r of retirements) {
    const key = `${r.season}:retire:${r.playerId}`;
    const posKo = POS_KO[r.position] ?? '';
    // 포지션별 대표 회고 스탯 — 값이 0이면 중립 문형으로(데이터 0인데 "벽" 칭송=가짜 드라마 방지, 2026-06-25 에디터)
    const stat = r.position === 'L' ? (r.digs > 0 ? `디그 ${r.digs.toLocaleString()}개로 수비를 책임진 리베로` : `${r.seasons}시즌 코트를 지킨 리베로`)
      : r.position === 'S' ? (r.assists > 0 ? `세트 어시스트 ${r.assists.toLocaleString()}개로 팀 공격을 조립한 야전사령관` : `${r.seasons}시즌 코트를 지킨 세터`)
      : r.position === 'MB' ? (r.blocks > 0 ? `블로킹 ${r.blocks.toLocaleString()}개로 네트 앞을 지킨 벽` : `${r.seasons}시즌 코트를 지킨 미들 블로커`)
      : (r.points > 0 ? `통산 ${r.points.toLocaleString()}점을 책임진 득점원` : `${r.seasons}시즌 코트를 지킨 ${posKo}`);
    const arc = prospectArcRetro(r.playerId); // 드래프트 출신 은퇴자 커리어 유형 회고(대기만성/즉시전력 — 현역엔 미노출)
    const ageTail = (r.age ?? 0) >= RETIRE_AGE ? ` 리그 정년(${RETIRE_AGE}세)을 맞아 코트를 정리했다.` : ''; // 40세 정년 은퇴는 사실 기반 문구
    const tail = ageTail + (r.legend ? ` ${teamName(r.teamId)}은(는) 헌액 번호 ${jerseyNumber(r.playerId)}번을 전당에 새겨 영원히 기린다.`
      : r.hof ? ' 통산 기록은 명예의전당에 새겨진다.' : '') + (arc ? ` ${arc}` : '');
    push(r.season, 'retire', vh([
      (n) => `${n}, ${r.seasons}시즌 커리어 마치고 은퇴`,
      (n) => `코트를 떠나는 ${n} — ${r.seasons}시즌의 여정`,
      (n) => `${teamName(r.teamId)}의 ${n}, 은퇴 선언`,
    ], key, r.name), r.legend, r.teamId,
      body3('retire', key, `${teamName(r.teamId)}의 ${posKo} ${r.name}이(가) ${r.seasons}시즌의 커리어를 마치고 코트를 떠난다. ${josa(stat, '이었다', '였다')}.` + tail), r.playerId);
  }

  // 4) 이번 시즌 부상 — 경미 포함 전 심각도 단신(2026-07-04 사용자 결정: 부상 소식을 뉴스 한 곳에서 다 보게).
  //    시즌아웃만 big(★). 선수당 시즌 1건(key dedup)이라 도배 방지. 미래 부상은 리그 진행 컷오프로 제외.
  for (const s of seasonInjuryReport()) {
    if (s.from > leagueDay) continue; // 아직 안 일어난 미래 부상 제외 — 리그 진행 컷오프(NEWS_SYSTEM §3.5)
    const out = s.severity === 'season' ? '시즌아웃' : `약 ${s.missMatches}경기 결장`;
    const key = `${currentSeason}:inj:${s.playerId}`;
    push(currentSeason, 'injury', `${pName(s.playerId)} ${SEVERITY_KO[s.severity]} — ${out}`, s.severity === 'season', s.teamId,
      body3('injury', key, `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SEVERITY_KO[s.severity]} 판정을 받아 ${out}이(가) 예상된다. ${teamName(s.teamId)}은(는) 당분간 ${posKoOf(s.playerId)} 자리를 메워야 한다.`), s.playerId, s.from);
  }

  // 5) 사건·사고 — 아주 가끔, 리그를 뒤흔드는 헤드라인
  for (const s of seasonScandals()) {
    if (s.from > leagueDay) continue; // 아직 안 터진 미래 사건 제외 — 리그 진행 컷오프(NEWS_SYSTEM §3.5)
    push(currentSeason, 'scandal', `[단독] ${pName(s.playerId)}(${teamName(s.teamId)}), ${SCANDAL_KO[s.kind]} — ${s.missMatches}경기 출장 정지`, true, s.teamId,
      body3('scandal', `${currentSeason}:sc:${s.playerId}`, `${pName(s.playerId)}(${teamName(s.teamId)})이(가) ${SCANDAL_KO[s.kind]}으로(로) ${s.missMatches}경기 출장 정지 징계를 받았다.`), s.playerId, s.from);
  }

  // 6) 영구제명 — 리그를 뒤흔드는 최대 사건(승부조작·학폭). 영속 기록에서.
  for (const e of expelled) {
    push(e.season, 'scandal', `[속보] ${e.name}(${teamName(e.teamId)}), ${EXPEL_KO[e.kind]} 적발 — 영구제명(리그 영구 퇴출)`, true, e.teamId,
      body3('scandal', `${e.season}:ex:${e.playerId}`, `${e.name}(${teamName(e.teamId)})이(가) ${EXPEL_KO[e.kind]}으로(로) 적발돼 리그에서 영구제명됐다. 코트로 돌아올 수 없으며, 그 이름은 불명예 기록으로만 남는다.`), e.playerId);
  }

  // 7) 구단주 — 인기 스타를 벤치로 보낸 건의가 받아들여졌을 때 팬심이 술렁(OWNER_SYSTEM 팬 분노 연동)
  //   철회된 지시(toDay 박힘, A3)는 선수가 복귀했으므로 술렁 기사 대상 아님 — 활성 지시만.
  for (const b of benchDirectives) {
    if (b.toDay != null) continue; // 철회(종결)된 지시 제외 — 활성만 팬 분노
    const p = getPlayer(b.playerId); if (!p) continue;
    const pop = popularityNow(p, leagueDay, archive);
    if (pop < 60) continue; // 인기 스타만 — 무명 선수 벤치는 기사 안 남
    push(currentSeason, 'owner', `팬들, 간판 ${p.name} 벤치 기용에 술렁 — "왜 안 쓰나"`, pop >= 78, myTeamId,
      body3('owner', `${currentSeason}:own:${b.playerId}`, `${teamName(myTeamId)}의 간판 ${p.name}이(가) 최근 출전 명단에서 빠지면서 팬들이 술렁이고 있다. "왜 안 쓰나"라는 목소리가 커지고 있다.`), b.playerId, leagueDay);
  }

  // 7.5) FA 이적·방출(슬라이스3·4) — 내 팀 in/out + 타팀 거물(포착 단계서 게이트됨, NEWS_SYSTEM §3.3).
  //   렌더 단계서도 타팀은 거물(이동시점 ovr≥REL_NEWS_OVR)만 — 구세이브(ovr 없는 무게이트 이적 로그) 범람 차단.
  const REL_NEWS_OVR = 71;
  for (const t of transfers) {
    if (t.kind === 'resign') continue; // 재계약 도장(FA §2.5c-격상)은 오프시즌 결산 1건에만 묶임(개별 기사 X — 노이즈 정책)
    const inMine = t.toTeam === myTeamId, outMine = t.fromTeam === myTeamId;
    if (!inMine && !outMine && (t.ovr ?? 0) < REL_NEWS_OVR) continue; // 타팀은 거물만(ovr 없으면=구세이브 무게이트 → 숨김)
    // ── 방출/재계약 불발(release) — toTeam='' ──
    if (t.kind === 'release') {
      const bigRel = (t.ovr ?? 0) >= 82; // 이동 시점 OVR — 거물 베테랑 방출 = 헤드라인(이후 노쇠 무관)
      const rkey = `${t.season}:rel:${t.playerId}`;
      // ② SIT_OUT 미계약(FA_SYSTEM §2.8.6) — 입찰이 있었는데도 선수가 전부 거절해 어느 팀과도 계약 못 함(무소속 시즌).
      //   bids 0(아무도 안 부름)엔 이 톤 금지(가짜 드라마 — 물리칠 제안이 없었으니).
      if (t.satOut) {
        push(t.season, 'release', vh([
          (n) => `${n}, 모든 제안 거절하고 계약 없이 한 시즌`,
          (n) => `FA ${n}, 시장에서 계약하지 못했다 — 무소속`,
          (n) => `${n}, 러브콜 모두 뿌리쳐 소속팀 없이`,
        ], rkey, t.name), bigRel, t.fromTeam,
          body3('release', rkey, more(
            `${t.name}이(가) 여러 구단의 제안을 받았지만 모두 거절해, 이번 시즌을 소속팀 없이 보내게 됐다.`,
            careerLine(t.playerId),
            outMine ? `${teamName(myTeamId)}으로서는 익숙한 얼굴을 시장에서 지켜본 셈이다.` : '')), t.playerId);
        continue;
      }
      // 재계약 불발 사유(FA §2.5c-격상 — 내 팀 만료FA에만 t.reason). 캡압박·뿌리침·미제안으로 헤드라인·리드 분기.
      const headByReason = outMine && t.reason ? ({
        capSqueezed: (n: string) => `${teamName(myTeamId)}, ${n} 캡에 밀려 이별 — FA 시장으로`,
        refused: (n: string) => `${n}, ${teamName(myTeamId)} 제안 뿌리치고 FA행`,
        notOffered: (n: string) => `${teamName(myTeamId)}, ${n} 재계약 접고 결별`,
      } as const)[t.reason] : null;
      const leadByReason = outMine && t.reason ? ({
        capSqueezed: `${t.name}이(가) 샐러리캡에 밀려 ${teamName(myTeamId)}과(와) 재계약하지 못하고 FA 시장에 나왔다.`,
        refused: `${t.name}이(가) ${teamName(myTeamId)}의 재계약 제안을 뿌리치고 FA 시장에 나왔다. 한 시즌을 건 약속은 성사되지 못했다.`,
        notOffered: `${teamName(myTeamId)}이(가) ${t.name}에게 재계약을 제안하지 않아, 선수는 FA 시장에 나왔다.`,
      } as const)[t.reason] : `${t.name}이(가) ${teamName(t.fromTeam)}을(를) 떠나 FA 시장에 나왔다. 새 시즌 명단에 이름을 올리지 못했다.`;
      push(t.season, 'release', vh([
        headByReason ?? ((n) => `${teamName(t.fromTeam)}, ${n} 방출 — FA 시장으로`),
        (n) => `${n}, ${teamName(t.fromTeam)}와(과) 재계약 불발`,
        (n) => outMine ? `${teamName(myTeamId)}, ${n} 방출` : `FA ${n}, ${teamName(t.fromTeam)} 떠난다`,
      ], rkey, t.name), bigRel, t.fromTeam,
        body3('release', rkey, more(
          leadByReason,
          careerLine(t.playerId),
          // 인간관계(현재 사실 — 가짜 드라마 아님): 떠난 팀에 가까운 동료가 남아 있으면 이별 한 줄(이적의 정서적 대칭, RELATIONSHIP §6)
          (() => { const f = topFriendOnTeam(t.playerId, t.fromTeam); return f ? `각별한 동료 ${f.name}을(를) ${teamName(t.fromTeam)}에 남기고 떠난다.` : ''; })(),
          outMine ? `${teamName(myTeamId)}은(는) 한 자원을 정리했다.` : '')), t.playerId);
      continue;
    }
    // ── 팀→팀 이적(transfer) — 내 팀은 헤드라인, 타팀 거물은 단신 ──
    const key = `${t.season}:tr:${t.playerId}`;
    // ① 카운터 수락 계약(FA_SYSTEM §2.8.6) — 내가 counterTolerance로 선수의 추가 요구를 수용해 서명(inMine 서명만 기록됨).
    const cameByCounter = inMine && typeof t.counteredTo === 'number';
    push(t.season, 'transfer', cameByCounter ? vh([
      (n) => `${teamName(t.toTeam)}, ${n} 요구 수용해 영입 — ${formatMoney(t.counteredTo!)}`,
      (n) => `FA ${n}, 더 나은 대우 받고 ${teamName(t.toTeam)}행`,
      (n) => `${teamName(t.toTeam)}, ${n} 붙잡으려 지갑 열었다`,
    ], key, t.name) : vh([
      (n) => `${n}, ${teamName(t.fromTeam)} 떠나 ${teamName(t.toTeam)} 이적`,
      (n) => inMine ? `${teamName(t.toTeam)}, FA ${n} 영입` : `FA ${n}, ${teamName(t.fromTeam)} → ${teamName(t.toTeam)}`,
      (n) => `FA ${n}, ${teamName(t.toTeam)} 합류`,
    ], key, t.name), inMine, inMine || outMine ? myTeamId : t.toTeam,
      (() => {
        const posKo = POS_KO[getPlayer(t.playerId)?.position ?? ''] ?? '';
        const tag = [t.ovr ? `OVR ${t.ovr}` : '', posKo].filter(Boolean).join(' ');
        const lead = tag ? `${tag} ${t.name}` : t.name;
        const gain = posKo ? `${posKo} 자원을 보강했다` : '전력을 더했다';
        const lose = posKo ? `${posKo} 한 자리가 비었다` : '한 자원을 떠나보냈다';
        // 인간관계(현재 사실 — 가짜 드라마 아님): 옮긴 팀에 가까운 동료가 있으면 재회 한 줄(RELATIONSHIP §6)
        const friend = topFriendOnTeam(t.playerId, t.toTeam);
        const friendLine = friend ? ` 새 팀에는 각별한 동료 ${friend.name}이(가) 있다.` : '';
        // 카운터 수용 한 줄(§2.8.6) — 선수가 더 요구했고 우리가 받아들였다는 사실(가짜 드라마 아님).
        const counterLine = cameByCounter ? ` ${teamName(myTeamId)}은(는) 선수의 추가 요구를 받아들여 ${formatMoney(t.counteredTo!)}에 계약을 매듭지었다.` : '';
        return body3('transfer', key, `${lead}이(가) ${teamName(t.fromTeam)}을(를) 떠나 ${teamName(t.toTeam)}으로(로) 둥지를 옮겼다.`
          + (inMine ? ` ${teamName(myTeamId)}이(가) ${gain}.` : outMine ? ` ${teamName(myTeamId)}은(는) ${lose}.` : ` ${teamName(t.toTeam)}이(가) ${gain}.`) + counterLine + friendLine);
      })(), t.playerId);
  }

  // 8) 실시간 경기 소재(현재 시즌) — 트리플 크라운·데뷔전·한 경기 폭발. 경기 단위 생산에서 파생.
  //   트리플 크라운 정의는 KOVO 공식(후위공격·블로킹·서브 각 3+) — broadcast.ts와 동일(simNews 교차검증).
  const TRIPLE_MIN = 3, BIG_GAME = 30;
  // 유망주 데뷔 게이트 — talentBase 등급(seed rollTalent): S 3%(≥1.25)·A 12%(≥1.12)·B 45%·C 30%·D 10%.
  const PROSPECT_MIN = 1.12, ELITE_MIN = 1.25; // A급 이상만 기사화, S급은 ★(특급 기대주)
  const debuted = new Set<string>(); // 이번 시즌 첫 선발 1회만
  // 트리플 크라운·한 경기 폭발은 선수당 1건으로 묶는다(한 시즌 8건 폭주 방지, 2026-06-25 에디터) — 시즌 N번째/최고 경기.
  const tc = new Map<string, { count: number; tid: string; name: string; back: number; b: number; a: number; day: number }>();
  const bg = new Map<string, { tid: string; name: string; points: number; spikes: number; aces: number; blocks: number; opp: string; day: number }>();
  for (const mp of seasonMatchProds(leagueDay)) {
    const teamOf = (id: string) => (mp.homeIds.has(id) ? mp.homeTeamId : mp.awayTeamId);
    for (const [id, l] of mp.lines) {
      const p = getPlayer(id); if (!p) continue;
      const tid = teamOf(id);
      const opp = tid === mp.homeTeamId ? mp.awayTeamId : mp.homeTeamId; // 상대팀(본문 보강)
      // 트리플 크라운(KOVO) — 후위공격·블로킹·서브 각 3+. 선수당 누적(첫 경기 스탯 + 시즌 횟수).
      if (l.backSpikes >= TRIPLE_MIN && l.blocks >= TRIPLE_MIN && l.aces >= TRIPLE_MIN) {
        const e = tc.get(id);
        if (e) { e.count++; e.day = mp.dayIndex; } else tc.set(id, { count: 1, tid, name: p.name, back: l.backSpikes, b: l.blocks, a: l.aces, day: mp.dayIndex });
      }
      // 데뷔전 — 통산 출전 0(이번 시즌이 데뷔)인 선수의 첫 선발만. **유망주(잠재력 높은 신인)만**: 리그 전체
      // 신인 데뷔를 다 기사화하면 첫 경기에 ~50건 쏟아짐 → talentBase A급 이상(상위 15%)만, S급은 ★(2026-06-21 사용자 보고).
      // 팀 무관(라이벌 1순위 유망주 데뷔도 리그 사건). **포지션별 대표 스탯**(리베로 득점 0 정상 → 디그·리시브, 세터 세트)
      if (!debuted.has(id) && mp.starters.has(id) && (p.career?.matches ?? 0) === 0 && p.talentBase >= PROSPECT_MIN) {
        debuted.add(id);
        const elite = p.talentBase >= ELITE_MIN;
        const tier = elite ? '특급 기대주' : '유망주';
        const posKo = POS_KO[p.position] ?? '';
        const stat = p.position === 'L' ? `디그 ${l.digs}개·리시브 ${l.receives}개`
          : p.position === 'S' ? `세트 ${l.assists}개`
          : `${l.points}점`;
        push(currentSeason, 'debut', `${tier} ${p.name} 데뷔전 — ${stat} (${posKo})`, elite, tid,
          body3('debut', `${currentSeason}:db:${id}`, more(
            `${teamName(tid)}의 ${tier} ${posKo} ${p.name}이(가) 첫 선발 무대에 나서 ${stat}을(를) 기록했다.`,
            `상대 ${teamName(opp)}을(를) 맞은 데뷔전이었다.`,
            elite ? 'S급 재능으로 분류된 특급 유망주로, 팀의 미래를 책임질 재목으로 꼽힌다.' : '높은 잠재력을 인정받은 기대주로, 성장 곡선에 시선이 모인다.')), id, mp.dayIndex);
      }
      // 한 경기 폭발(커리어하이급) — 30점 이상(데뷔 기사로 이미 다룬 경기는 제외). 선수당 시즌 최고 경기만.
      else if (l.points >= BIG_GAME) {
        const e = bg.get(id);
        if (!e || l.points > e.points) bg.set(id, { tid, name: p.name, points: l.points, spikes: l.spikes, aces: l.aces, blocks: l.blocks, opp, day: mp.dayIndex });
      }
    }
  }
  // 트리플 크라운 — 선수당 1건(여러 번이면 "시즌 N번째")
  for (const [id, e] of tc) {
    const multi = e.count > 1 ? ` (시즌 ${e.count}번째)` : '';
    push(currentSeason, 'match', `${e.name} 트리플 크라운${multi} — 후위공격 ${e.back}·블로킹 ${e.b}·서브 ${e.a}`, true, e.tid,
      body3('triple', `${currentSeason}:tc:${id}`, `${e.name}(${teamName(e.tid)})이(가) 후위공격 ${e.back}개·블로킹 ${e.b}개·서브 에이스 ${e.a}개로 트리플 크라운을 달성했다.${e.count > 1 ? ` 이번 시즌 ${e.count}번째 대기록이다.` : ' KOVO 공식 기록에 이름을 올렸다.'}`), id, e.day);
  }
  // 한 경기 폭발 — 선수당 시즌 최고 경기 1건
  for (const [id, e] of bg) {
    push(currentSeason, 'match', `${e.name}, 한 경기 ${e.points}점 폭발`, e.points >= 35, e.tid,
      body3('biggame', `${currentSeason}:bg:${id}`, more(
        `${e.name}(${teamName(e.tid)})이(가) 한 경기 ${e.points}점을 몰아쳤다. 팀 공격을 통째로 짊어진 하루였다.`,
        `상대 ${teamName(e.opp)}을(를) 상대로 공격 성공 ${e.spikes}개·서브 에이스 ${e.aces}개·블로킹 ${e.blocks}개를 곁들였다.`)), id, e.day);
  }

  // 8.5) 순위 확정(clinch, NEWS_SYSTEM §3.1) — PO진출/정규1위직행/PO탈락이 **막 수학적으로 확정된 경기일**을 연대기로.
  //   전 구단(내 팀 포함) · 치른 경기 수학만(스포일러 안전 — 미래 결과 무관). day=확정 경기일 → 최신순·2주 만료.
  //   leagueDay 컷오프로 확정일 이후에만 노출(그 경기일을 관전해야 뜸). BROADCAST와 **병행**: 현수막=관전 연출(경기 종료 순간),
  //   뉴스=피드에 남는 연대기. 결과-중립 아님(확정 사건) — 그래서 leagueDay 게이트로 미래 확정 누출을 막는다.
  for (const ev of seasonClinchTransitions(leagueDay)) {
    const name = teamName(ev.teamId);
    const mine = ev.teamId === myTeamId;
    const S = currentSeason + 1;
    const ckey = `${currentSeason}:clinch:${ev.teamId}:${ev.kind}`; // 팀·종류당 1건(단조 → 전이 1회)
    if (ev.kind === 'title') {
      push(currentSeason, 'clinch', vh([
        (t) => `${t}, ${S}시즌 정규리그 1위 확정 — 챔프전 직행`,
        (t) => `정규리그 우승(1위) 확정 — ${t} 챔피언결정전으로`,
        (t) => `${t}, ${S}시즌 정규 1위 굳혔다 — 봄배구 직행`,
      ], ckey, name), true, ev.teamId,
        body3('clinchTitle', ckey, `${name}이(가) ${S}시즌 정규리그 1위를 확정하며 챔피언결정전에 직행했다. 남은 경기 결과와 무관하게 최종 1위가 수학적으로 확정됐다.`), ev.teamId, ev.day);
    } else if (ev.kind === 'po') {
      push(currentSeason, 'clinch', vh([
        (t) => `${t}, ${S}시즌 포스트시즌 진출 확정`,
        (t) => `${t} 봄배구 확정 — 포스트시즌行`,
        (t) => `포스트시즌 진출 확정 — ${t}`,
      ], ckey, name), mine, ev.teamId,
        body3('clinchPo', ckey, `${name}이(가) ${S}시즌 포스트시즌 진출을 확정했다. 남은 경기 결과와 무관하게 상위 3위 안이 수학적으로 보장됐다.`), ev.teamId, ev.day);
    } else {
      push(currentSeason, 'clinch', vh([
        (t) => `${t}, ${S}시즌 포스트시즌 탈락 확정`,
        (t) => `${t} 봄배구 좌절 — 포스트시즌 탈락`,
        (t) => `포스트시즌 탈락 확정 — ${t}`,
      ], ckey, name), false, ev.teamId,
        body3('clinchElim', ckey, `${name}이(가) ${S}시즌 포스트시즌 진출이 좌절됐다. 남은 경기를 모두 이겨도 상위 3위 안에 들 수 없어 탈락이 확정됐다.`), ev.teamId, ev.day);
    }
  }

  // 9) 모기업 기조 예고(FINANCE 2.0 Stage2b) — 막 끝난 시즌(lastSeason) 기준 다가오는 오프시즌 FA 기류.
  //   stance는 sponsorStanceOf(teamId, lastSeason, archive)로 순수 파생(새 저장 0·가짜 드라마 0). 소문 톤·불발 가능.
  //   최신 시즌만(예고는 미래형) — 과거 시즌 stance는 이미 transfer/release 결과 기사로 surface됨.
  if (archive.length) {
    const last = archive.reduce((m, a) => (a.season > m.season ? a : m), archive[0]);
    const spKey = (teamId: string) => `${last.season}:sp:${teamId}`;
    for (const teamId of last.standings ?? []) {
      const stance = sponsorStanceOf(teamId, last.season, archive);
      if (stance === 'aggressive') {
        push(last.season, 'sponsor', vh([
          (t) => `${t}, 큰손 등판설 — 거물 노린다`,
          (t) => `${t} 모기업 지갑 연다 — 공격 영입 예고`,
          (t) => `FA 앞두고 ${t} 공격 모드`,
        ], spKey(teamId), teamName(teamId)), teamId === myTeamId, teamId,
          body3('sponsorAggr', spKey(teamId), `${teamName(teamId)} 모기업이 다가오는 FA 시장에서 적극적인 투자에 나설 것으로 보인다.`), teamId);
      } else if (stance === 'thrifty') {
        push(last.season, 'sponsor', vh([
          (t) => `${t}, 이번 FA는 관망 — 긴축 기류`,
          (t) => `${t} 허리띠 졸라맨다 — 조용한 오프시즌 예고`,
          (t) => `${t}, 큰 영입보다 내실`,
        ], spKey(teamId), teamName(teamId)), false, teamId,
          body3('sponsorThrift', spKey(teamId), `${teamName(teamId)} 모기업이 다가오는 FA 시장에서 신중한 행보를 보일 전망이다.`), teamId);
      }
    }
  }

  // 10) 오프시즌 결산(§3.7) — "누가 왔고 갔나" 개막 뉴스. 직전 오프시즌(currentSeason−1)의 draft/transfer/foreign 로그 파생.
  //   day=0·season=currentSeason(개막 당일 최상단) — 리그 진행 컷오프 무관(오프시즌 사건은 첫 경기 전 확정, leagueDay=−1도 노출).
  const offSeason = currentSeason - 1;
  if (offSeason >= 0) {
    const posKoD = (pos: string) => POS_KO[pos] ?? '';
    // ── ① 종합 결산(내 팀, 오프시즌마다 항상 1건 — 리브니스) ──
    if (myTeamId) {
      const myDraft = seasonDraftLog.filter((d) => d.season === offSeason && d.teamId === myTeamId);
      const faIn = transfers.filter((t) => t.season === offSeason && t.toTeam === myTeamId && t.kind !== 'release' && t.kind !== 'resign');
      const faOut = transfers.filter((t) => t.season === offSeason && t.fromTeam === myTeamId && t.kind !== 'release' && t.kind !== 'resign' && t.toTeam);
      const relOut = transfers.filter((t) => t.season === offSeason && t.fromTeam === myTeamId && t.kind === 'release');
      const resignKept = transfers.filter((t) => t.season === offSeason && t.toTeam === myTeamId && t.kind === 'resign'); // 재계약 도장(FA §2.5c-격상)
      const myForeign = seasonForeignLog.filter((f) => f.season === offSeason && f.teamId === myTeamId);
      const inNames = [
        ...myDraft.map((d) => `${posKoD(d.position)} ${d.name}(신인)`),
        ...faIn.map((t) => `${t.name}(FA)`),
        ...myForeign.filter((f) => f.inName).map((f) => `${f.inName}(${f.asian ? '아시아쿼터' : '외인'})`),
      ];
      const outNames = [
        ...faOut.map((t) => `${t.name}(→${teamName(t.toTeam)})`),
        ...relOut.map((t) => `${t.name}(방출)`),
        ...myForeign.filter((f) => f.outName).map((f) => `${f.outName}(${f.asian ? '아시아쿼터' : '외인'})`),
      ];
      const S = currentSeason + 1;
      const quiet = inNames.length === 0 && outNames.length === 0 && resignKept.length === 0;
      const detail = [
        inNames.length ? `영입·입단 — ${inNames.join(', ')}.` : '',
        resignKept.length ? `재계약 유지 — ${resignKept.map((t) => t.name).join(', ')}.` : '', // 수락 도장(FA §2.5c-격상)
        outNames.length ? `방출·이적 — ${outNames.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
      const core = quiet
        ? `${teamName(myTeamId)}은(는) 이렇다 할 영입도 유출도 없이 기존 전력으로 ${S}시즌을 맞는다.`
        : `${teamName(myTeamId)}의 ${S}시즌 진용이 확정됐다. ${detail}`;
      push(currentSeason, 'offseason', quiet
        ? `${teamName(myTeamId)}, ${S}시즌 전력 유지 — 조용한 오프시즌`
        : `${teamName(myTeamId)}, ${S}시즌 진용 확정 (영입 ${inNames.length}·유출 ${outNames.length}${resignKept.length ? `·재계약 ${resignKept.length}` : ''})`,
        true, myTeamId, body3(quiet ? 'quietOff' : 'offseason', `${offSeason}:recap:${myTeamId}`, core), myTeamId, 0);
    }

    // ── ② 드래프트 입단 개별(내 팀 전 픽 + 타팀 1R). 안개: 포지션·순번만, 정확 OVR 없음 ──
    for (const d of seasonDraftLog.filter((dd) => dd.season === offSeason && (dd.teamId === myTeamId || dd.round === 1))) {
      const posKo = posKoD(d.position);
      const dkey = `${offSeason}:draft:${d.playerId}`;
      push(currentSeason, 'draft', vh([
        (n) => `${d.overallPick}순위 지명 — ${posKo} ${n} (${teamName(d.teamId)})`,
        (n) => `${teamName(d.teamId)}, ${d.round}R ${d.overallPick}순위로 ${posKo} ${n} 지명`,
        (n) => `신인 ${posKo} ${n}, ${teamName(d.teamId)} 유니폼`,
      ], dkey, d.name), d.teamId === myTeamId && d.round === 1, d.teamId,
        body3('draft', dkey, `${teamName(d.teamId)}이(가) 신인 드래프트 ${d.round}라운드 전체 ${d.overallPick}순위로 ${posKo} ${d.name}을(를) 지명했다.`), d.playerId, 0);
    }

    // ── ③ 외인·아시아쿼터 교체 개별(전 팀 — 외인=리그 가시) ──
    for (const f of seasonForeignLog.filter((ff) => ff.season === offSeason)) {
      const ko = f.asian ? '아시아쿼터' : '외국인 선수';
      const fkey = `${offSeason}:foreign:${f.teamId}:${f.asian ? 'a' : 'f'}`;
      const headline = f.inName && f.outName ? `${teamName(f.teamId)}, 새 ${ko} ${f.inName} 영입 — ${f.outName}와(과) 결별`
        : f.inName ? `${teamName(f.teamId)}, ${ko} ${f.inName} 영입`
        : `${teamName(f.teamId)}, ${ko} ${f.outName} 결별 — 자리 공백`;
      const core = f.inName && f.outName ? `${teamName(f.teamId)}이(가) ${ko} ${f.outName}을(를) 내보내고 새 ${ko} ${f.inName}을(를) 영입했다.`
        : f.inName ? `${teamName(f.teamId)}이(가) 새 ${ko} ${f.inName}을(를) 영입했다.`
        : `${teamName(f.teamId)}이(가) ${ko} ${f.outName}와(과) 결별하며 그 자리가 비었다.`;
      push(currentSeason, 'foreign', headline, f.teamId === myTeamId, f.teamId, body3('foreign', fkey, core), f.inId ?? f.outId, 0);
    }
  }

  // 11) 포스트시즌(달력 편입, SEASON_SYSTEM §5.2) — **치른(공개) 경기까지만**. 컷오프 = 포스트시즌 트랙(poDay=raw currentDay,
  //   postseasonReveal 파생 — 결승 전 우승 누출 0). kord=자동 순번이지만 생성 순서가 게임 순서로 고정(append-only)이라 안정,
  //   ref=시리즈:게임 번호(엔티티 앵커 — 헤드라인 키 금지). **우승 기사는 archive(champion) 경로**(recordChampion이 결승 확정
  //   후에만 적립 → 타이밍 자동 게이트) — 여기선 경기·시리즈 확정 기사만(중복 금지). 노출 게이트는 일정 화면이 건다(뉴스는 파생만).
  if (poDay > SEASON_DAYS) {
    const p = buildPlayoffs(currentSeason);
    const rv = postseasonReveal(p, poDay);
    // champClinch: 결승 마지막(클린치) 게임 전용 — 그 경기 기사에 "다음 경기" 대신 우승 확정 + 대역전/스윕 서사(실 시리즈 데이터).
    const gameNews = (m: NonNullable<typeof p.po>, roundKo: string, slots: readonly number[], revealed: number, refBase: string, done = false, champClinch = false) => {
      let hiW = 0, loW = 0;
      for (let g = 0; g < revealed; g++) {
        const gm = m.series.games[g];
        const hiWon = gm.hiSets > gm.loSets;
        if (hiWon) hiW++; else loW++;
        const wId = hiWon ? m.hiId : m.loId, lId = hiWon ? m.loId : m.hiId;
        const wS = Math.max(gm.hiSets, gm.loSets), lS = Math.min(gm.hiSets, gm.loSets);
        // 시리즈 스코어는 **그 경기 승자 관점**(wW-lW) — 하위 시드가 이겨도 "승자 X (시리즈 1-0)"로 읽히게
        //   (시리즈 확정 기사 :688와 동일 관례). hiW-loW(시드 관점)로 쓰면 승자가 뒤지는 것처럼 보이는 버그.
        const wW = hiWon ? hiW : loW, lW = hiWon ? loW : hiW;
        const gkey = `${currentSeason}:${refBase}:${g}`;
        // 결승 클린치 게임(시리즈 종료 + 마지막 공개 경기) — 그 승자가 챔피언. "다음 경기" close 금지, 우승 서사(테스터 2026-07-12).
        if (champClinch && done && g === revealed - 1) {
          // 우승팀 게임별 승패 패턴(우승팀 관점)으로 대역전/스윕 판정 — champion 뉴스(:255)와 동일 사실 기반.
          const pat = m.series.games.slice(0, revealed).map((x) => ((x.hiSets > x.loSets ? m.hiId : m.loId) === wId ? 'W' : 'L'));
          const reverse = pat.length === 5 && pat[0] === 'L' && pat[1] === 'L' && pat.slice(2).every((c) => c === 'W');
          const sweep = pat.length === 3 && pat.every((c) => c === 'W');
          const champBody = `${roundKo} ${g + 1}차전에서 ${teamName(wId)}이(가) ${teamName(lId)}을(를) 세트 ${wS}-${lS}로 꺾고 시리즈 ${wW}-${lW}로 ${currentSeason + 1}시즌 정상에 올랐다.`
            + (reverse ? ' 2패 뒤 3연승, 리버스 스윕의 대역전 우승이다.' : sweep ? ' 3-0 스윕으로 끝낸 완벽한 대관식이다.' : '');
          push(currentSeason, 'playoff', vh([
            (w) => `${roundKo}는 ${w}의 것 (${wW}-${lW}) — 우승 확정${reverse ? ' · 대역전' : ''}`,
            (w) => `${w}, ${roundKo} 제패 — ${wW}-${lW}로 정상${reverse ? ' (리버스 스윕)' : ''}`,
          ], gkey, teamName(wId)), true, wId, champBody, `${refBase}:${g}`, slots[g]);
          continue;
        }
        const core = `${roundKo} ${g + 1}차전에서 ${teamName(wId)}이(가) ${teamName(lId)}을(를) 세트 ${wS}-${lS}로 꺾었다. 시리즈 스코어 ${wW}-${lW}.`;
        push(currentSeason, 'playoff', vh([
          (w) => `${roundKo} ${g + 1}차전 — ${w} 승리 (시리즈 ${wW}-${lW})`,
          (w) => `${w}, ${roundKo} ${g + 1}차전 잡았다 — 세트 ${wS}-${lS}`,
          (w) => `${roundKo} ${g + 1}차전은 ${w}의 것 (${wW}-${lW})`,
        ], gkey, teamName(wId)), false, wId, body3('playoff', gkey, core), `${refBase}:${g}`, slots[g]);
      }
    };
    if (p.po) {
      gameNews(p.po, '플레이오프', PO_SLOTS, rv.poRevealed, 'po');
      if (rv.poDone) { // 시리즈 확정 — 결승 대진 확정 기사
        const w = p.po.winnerId;
        const wWins = p.po.series.hiWon ? p.po.series.hiWins : p.po.series.loWins;
        const lWins = p.po.series.hiWon ? p.po.series.loWins : p.po.series.hiWins;
        const ckey = `${currentSeason}:poclinch`;
        push(currentSeason, 'playoff', vh([
          (t) => `${t}, 챔피언결정전 진출 — 결승 대진 확정`,
          (t) => `결승 대진 확정 — ${teamName(p.seeds[0])} vs ${t}`,
        ], ckey, teamName(w)), true, w,
          body3('playoff', ckey, `${teamName(w)}이(가) 플레이오프 시리즈를 ${wWins}-${lWins}로 끝내고 챔피언결정전에 진출했다. 정규리그 1위 ${teamName(p.seeds[0])}와(과) 왕좌를 다툰다.`),
          'po:clinch', PO_SLOTS[p.po.series.games.length - 1]);
      }
    }
    if (p.final) gameNews(p.final, '챔피언결정전', FINAL_SLOTS, rv.finalRevealed, 'final', rv.finalDone, true);
  }

  // 정렬(NEWS_SYSTEM §9 — 2026-07-05 최신순 전환): 현재 시즌 인게임 뉴스(day 있음)를 **최신순(같은 날 중요도순)** 으로
  //   최상단에, 그 아래 과거 시즌 요약뉴스(day 없음)는 시즌↓·중요도↓. **완전한 목록**(가드는 전량 검증) —
  //   2주 만료는 표시 계층(`freshNews`)에서 걸러 목록/카운트에 적용(buildNewsFeed는 순수·전량 유지).
  return items.sort((x, y) => {
    const xd = x.day, yd = y.day;
    if (xd != null && yd != null) return yd - xd || Number(y.big) - Number(x.big); // 둘 다 인게임 → 최신순, 같은 날 중요도
    if (xd != null) return -1; // 인게임(신선)이 요약보다 위
    if (yd != null) return 1;
    return y.season - x.season || Number(y.big) - Number(x.big);                    // 과거 요약끼리 — 기존(시즌↓·중요도↓)
  });
}

/** 표시용 최신 뉴스 — 2주(14일) 지난 인게임 뉴스는 만료 제외(요약뉴스=day 없음은 유지). 목록·미읽음 카운트 공용(NEWS_SYSTEM §9). */
export const NEWS_FRESH_DAYS = 14;
export function freshNews(feed: NewsItem[], displayDay: number): NewsItem[] {
  return feed.filter((n) => n.day == null || n.day >= displayDay - NEWS_FRESH_DAYS);
}

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, PosTag, Row, Screen, StatBar, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { RoleBadge } from '../components/RoleBadge';
import { Popup } from '../components/Popup';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { ToastHost, useToastQueue } from '../components/Toast';
import { shortTeamName as shortTeam, getTeam, teamScoutReveal } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { repRecordLine } from '../data/recordLine';
import { buildOffseasonBase, scandalRepMap } from '../data/offseason';
import { resolveFAPreviewFor } from '../data/offseasonArgs';
import { buildOwnerFx } from '../data/owner';
import { projectSettledCash } from '../data/financeProjection';
import { LEAGUE_CAP } from '../engine/cap';
import { needsCompensationPlayer, pickCompensation, PROTECT_COUNT } from '../engine/compensation';
import { assignFAGrades, askingPrice, DEFAULT_FA_OFFER, prefWeightsOf } from '../engine/faMarket';
import { buildLineup } from '../engine/lineup';
import { ALL_POSITIONS, overall, overallRaw, REVEAL_PRECISE } from '../engine/overall';
import { capContractYears } from '../engine/retire';
import { deriveRatings } from '../engine/ratings';
import { formatMoney } from '../engine/salary';
import { marketVal } from '../data/awardSalary';
import { teamRelations, relationBonds } from '../data/relationships';
import {
  offerSatisfaction, offerSalaryBounds, PREF_STAR_AXES, starsFromWeight, resolveMyOfferSalary,
} from '../data/faOfferSatisfaction';
import type { FAOffer } from '../types';
import { useGameStore } from '../store/useGameStore';

// 선수 역제안 카운터 한도(FA_SYSTEM §2.8.6) — +0 ~ +1.0억, step 0.1억(연봉 단위 만원). +0=미설정(counterTolerance undefined → 0드리프트).
const COUNTER_STEP = 1000;  // 0.1억
const COUNTER_MAX = 10000;  // +1.0억

/** 상태 배지 — 텍스트가 바뀔 때만 페이드+스케일로 전환 연출(FA_SYSTEM §2.8.7). 첫 렌더·무변경 시엔 무연출(안 바뀐 선수는 그대로). */
function AnimatedBadge({ text, color }: { text: string; color: string }) {
  const a = useRef(new Animated.Value(1)).current;
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      a.setValue(0.3);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, friction: 6, tension: 80 }).start();
    }
  }, [text, a]);
  return (
    <Animated.Text
      style={{
        color, fontSize: 12, fontWeight: '800', marginTop: 2,
        opacity: a,
        transform: [{ scale: a.interpolate({ inputRange: [0.3, 1], outputRange: [0.9, 1] }) }],
      }}
    >
      {text}
    </Animated.Text>
  );
}

export default function FACenter() {
  // FA 시장 경쟁 미리보기(faMarketPreview)+정산 자금 투영은 무거워 한 틱 미뤄 로딩부터 그린다
  const ready = useDeferredReady();
  if (!ready) return <Loading title="FA 시장" variant="list" />;
  return <FACenterInner />;
}

function FACenterInner() {
  const router = useRouter();
  const my = useGameStore((s) => s.selectedTeamId)!;
  const season = useGameStore((s) => s.season);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const contractOverrides = useGameStore((s) => s.contractOverrides);
  const faOffers = useGameStore((s) => s.faOffers);
  // 파생(§2.8 Phase1) — faSignings=지명 keys, faAggressive=오퍼 중 하나라도 공격적(전역 토글 표시용). 레버 UI는 Phase 4.
  const faSignings = useMemo(() => Object.keys(faOffers), [faOffers]);
  const faAggressive = useMemo(() => Object.values(faOffers).some((o) => o.aggressive), [faOffers]);
  const protectedIds = useGameStore((s) => s.protectedIds);
  const moneyOnlyIds = useGameStore((s) => s.moneyOnlyIds);
  // 트라이아웃/아시아 토글 — endSeason과 동일 인자로 미리보기해야 preview=result(EC-FA-09).
  //   외인/아시아 영입은 국내 FA 지갑(cashAfterImports)·로스터 구멍에 영향 → FA 경쟁 결과가 바뀐다.
  const tryoutWish = useGameStore((s) => s.tryoutWish);
  const keepForeign = useGameStore((s) => s.keepForeign);
  const asianWish = useGameStore((s) => s.asianWish);
  const keepAsian = useGameStore((s) => s.keepAsian);
  const signFA = useGameStore((s) => s.signFA);
  const unsignFA = useGameStore((s) => s.unsignFA);
  const setOffer = useGameStore((s) => s.setOffer);
  const setAggressive = useGameStore((s) => s.setAggressive);
  const toggleProtect = useGameStore((s) => s.toggleProtect);
  const toggleMoneyOnly = useGameStore((s) => s.toggleMoneyOnly);
  const interviews = useGameStore((s) => s.interviews);
  const fanScore = useGameStore((s) => s.fanScore);
  const cash = useGameStore((s) => s.cash);
  const archive = useGameStore((s) => s.archive);
  const bonds = useGameStore((s) => s.bonds);
  // 영입/보호/돈만/공격적 토글은 pv(faMarketPreview) useMemo의 dep이라 매 탭마다 FA 경쟁 결정론을 전면 재해결(무거움) → 오버레이 마스킹(UI-27)
  const busy = useBusyRun();
  // 개념 안내 모달(UI-21 — 네이티브 Alert 금지). 'delay'=지연 구조, 'comp'=보상선수/돈만
  const [info, setInfo] = useState<null | 'delay' | 'comp'>(null);
  // 상세 펼침(오퍼 폼) — 관전형 옵트인(§2.8.4 ④): 한 번에 하나만, 펼친 사람에게만 폼 공개.
  const [openId, setOpenId] = useState<string | null>(null);
  // 오퍼 폼 로컬 draft(적용 전까지 미영속) — 슬라이더 조작이 무거운 pv 재해결을 안 건드리게(만족도만 즉시 갱신).
  const [drafts, setDrafts] = useState<Record<string, FAOffer>>({});
  const reveal = teamScoutReveal(my); // 스카우팅 공개도 — 성향 별점 안개 게이트(드래프트와 동일 소스)
  const bondsCtx = useMemo(() => relationBonds(), [bonds]); // relT 소스 — 미리보기(resolveFAMarket)와 동일

  // 이번 시즌 정산 후 운영 자금 — endSeason이 FA에 쓰는 실제 지갑(모기업 지원·관중 수입 반영).
  //   store.cash(직전 정산값)로 미리보기하면 모기업 지원(14~28억)이 빠져 "영입 불가"로 오표시된다.
  const budgetCash = useMemo(
    () => projectSettledCash(my, season, cash, fanScore, archive),
    [my, season, cash, fanScore, archive],
  );

  // 경쟁 결과 미리보기(결정론) — 영입 성공/실패 예상.
  // endSeason과 동일한 ownerFx(면담·불만 거부)+정산 후 운영 자금을 넣어야 미리보기=결과가 보장된다.
  // 스냅샷/해결 분리(REALTIME_SIM §7.3): 무거운 롤오버 base는 안정 deps로 메모, 영입/보호/돈만/공격적 토글은 가벼운 해결만 재실행.
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore, contractOverrides), [interviews, season, my, fanScore, contractOverrides]);
  const base = useMemo(
    () => buildOffseasonBase(my, resignDecisions, contractOverrides, season + 1, ownerFx),
    [my, resignDecisions, contractOverrides, season, ownerFx],
  );
  const pv = useMemo(
    () => resolveFAPreviewFor(base, { my, resignDecisions, contractOverrides, faOffers,
      protectedIds, nextSeason: season + 1, ownerFx, myCash: budgetCash, tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian }),
    [base, my, resignDecisions, contractOverrides, faOffers, protectedIds, season, ownerFx, budgetCash,
      tryoutWish, keepForeign, moneyOnlyIds, asianWish, keepAsian],
  );
  const snap = pv.snapshot;
  // 등급·요구연봉은 **pre-FA(시장 해석 전) 스냅샷**으로 매긴다(FA_SYSTEM §2.2 — 엔진 resolveFAMarket이 등급·보상금을
  //   직전연봉으로 산정). pv.snapshot(해석 후)은 영입 성사 선수의 연봉이 새 계약값이라 순위가 뒤바뀐다(EC-FA-09/08 형제).
  const preSnap = base.off.snapshot;
  const repMap = useMemo(() => scandalRepMap(), [season]); // 사고 선수 요구연봉 할인(엔진 :150과 동일 산식)
  const round100 = (x: number) => Math.round(x / 100) * 100;

  // FA 시장 변화 피드백(FA_SYSTEM §2.8.7) — pv(관측 파생)만 읽는다. 엔진·스토어 영속 무변경(가짜 드라마 금지: 실제 faFail/rank에서만).
  //   내 선택으로 지명 선수의 상태(성공/뺏김/게이트/미계약/협상중)가 pv 재해소로 바뀌면, "크게" 바뀐 선수만 하단 토스트로 알린다.
  //   배지 전환 연출은 각 배지(AnimatedBadge)가 텍스트가 바뀔 때 스스로 페이드+스케일 → 안 바뀐 선수는 무연출.
  const toast = useToastQueue();
  const statusOf = (id: string): { s: string; rank?: number } => {
    if (pv.signedByMe.has(id)) return { s: 'won' };
    const code = pv.faFail[id];
    const rank = pv.faCompete[id]?.myRank;
    if (code === 'LOST') return { s: 'lost', rank };
    if (code === 'CASH' || code === 'CAP' || code === 'ROSTER') return { s: 'gate' };
    if (code === 'SIT_OUT') return { s: 'sitout' };
    return { s: 'pending', rank };
  };
  const prevStatus = useRef<Record<string, { s: string; rank?: number }> | null>(null);
  useEffect(() => {
    const cur: Record<string, { s: string; rank?: number }> = {};
    for (const id of Object.keys(faOffers)) cur[id] = statusOf(id);
    const prev = prevStatus.current;
    if (prev) {
      for (const id of Object.keys(cur)) {
        const a = prev[id];
        const b = cur[id];
        if (!a) continue; // 새로 지명한 선수 — 첫 상태라 '변화'가 아님
        const nm = preSnap[id]?.name ?? '선수';
        if (a.s !== 'won' && b.s === 'won') toast.push(`FA 시장 변화. ${nm} 영입 가능성이 높아졌습니다.`);
        else if (a.s === 'won' && b.s !== 'won') toast.push(`FA 시장 변화. ${nm}과의 계약 가능성이 낮아졌습니다.`);
        else if (a.s === 'pending' && b.s === 'pending' && a.rank === 1 && (b.rank ?? 99) > 1)
          toast.push(`FA 시장 변화. ${nm} 계약에 다른 구단이 더 유력해졌습니다.`);
      }
    }
    prevStatus.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv]);

  const poolPlayers = pv.pool.map((id) => preSnap[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a));
  const grades = assignFAGrades(poolPlayers);
  const myRoster = pv.myRoster.map((id) => snap[id]).filter(Boolean).sort((a, b) => overall(b) - overall(a));

  // 예상 역할(주전/리베로) — 개막전이 실제로 쓰는 라인업(engine/lineup.buildLineup)을 **이 화면이 그리는
  // 다음시즌 스냅샷 로스터**에 적용해 도출(외인 포함 → OP 승부 반영). 뱃지는 아래 보호명단 행에 붙어
  // "뺏기면 아픈 주전"을 한눈에. training-camp roleOf와 같은 경로(스냅샷 로스터를 먹인다는 점만 다름).
  const roleOf: Record<string, '주전' | '리베로'> = {};
  if (myRoster.length) {
    const lu = buildLineup(myRoster);
    for (const p of lu.six) roleOf[p.id] = '주전';
    if (lu.libero) roleOf[lu.libero.id] = '리베로';
  }
  const isStarter = (id: string) => roleOf[id] === '주전' || roleOf[id] === '리베로';
  // 보호명단 = 국내 선수만(외인은 1년 계약이라 보상 대상 아님). 정렬: 주전+리베로 그룹 먼저(뺏기면 아픈 순),
  // 그다음 벤치 — 각 그룹 내 포지션순(ALL_POSITIONS), 동순위는 OVR 내림차순.
  const protectList = myRoster
    .filter((p) => !p.isForeign)
    .sort((a, b) => {
      const ga = isStarter(a.id) ? 0 : 1, gb = isStarter(b.id) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return ALL_POSITIONS.indexOf(a.position) - ALL_POSITIONS.indexOf(b.position) || overall(b) - overall(a);
    });

  // 캡은 국내 선수만(외인=별개 지갑, FOREIGN_SYSTEM 2장) — EC-CAP-01(2026-06-30). 외인 포함 시 허위 캡 초과.
  const myPayroll = pv.myRoster.reduce((s, id) => { const pl = snap[id]; return s + (pl && !pl.isForeign ? pl.contract.salary : 0); }, 0);
  const signedCost = [...pv.signedByMe].reduce((s, id) => s + (snap[id]?.contract.salary ?? 0), 0);
  const projected = myPayroll + signedCost;

  const projectedComp = pickCompensation(pv.myRoster, protectedIds, snap, []);
  const projectedCompName = projectedComp ? snap[projectedComp]?.name : null;
  // 보상선수가 실제로 빠지는 영입 = A/B 중 '돈만' 미선택분
  const compNeeded = [...pv.signedByMe].filter((id) => {
    const g = grades.get(id);
    return g ? needsCompensationPlayer(g) && !moneyOnlyIds.includes(id) : false;
  }).length;
  const moneyOnlyCount = [...pv.signedByMe].filter((id) => moneyOnlyIds.includes(id) && needsCompensationPlayer(grades.get(id) ?? 'C')).length;

  return (
    <Screen title={`${seasonYear(season)} → ${seasonYear(season + 1)} FA 시장`} overlay={<ToastHost toasts={toast.toasts} />}>
      {/* 협상 진행 안내(항상 표시, §2.8.9 #1) — 이 화면이 "계약 완료"가 아니라 "협상(미리보기) 진행 중"임을
          상단에 못박는다. 아래 모든 표시는 현재 오퍼 기준 예상 결과이며, 오퍼를 바꾸면 즉시 재계산된다. */}
      <Pressable onPress={() => setInfo('delay')} style={styles.notice}>
        <Ionicons name="hourglass-outline" size={18} color={theme.sky} />
        <View style={{ flex: 1 }}>
          <Text style={styles.noticeTitle}>FA 협상 진행 중</Text>
          <Text style={styles.noticeText}>
            현재는 모든 구단이 선수에게 계약을 제안하는 단계입니다. 시즌 시작 시 선수가 모든 제안을 비교한 뒤
            최종 팀을 선택합니다. 오퍼를 변경하거나 취소하면 예상 결과도 즉시 다시 계산됩니다.
            {' '}<Text style={{ color: theme.sky, fontWeight: '800' }}>자세히 ›</Text>
          </Text>
        </View>
      </Pressable>

      <Card accent={theme.sky}>
        <Row>
          <IconLabel icon="person-add-outline" color={theme.sky}>영입 성공 / 제안</IconLabel>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {pv.signedByMe.size} / {faSignings.length}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          영입 제안을 보내도 선수는 팀 전력·출전기회·충성도·연봉을 보고 결정합니다. 다른 구단과 경합에서
          질 수도, 마음에 드는 제안이 없으면 선수가 모든 제안을 거절할 수도 있어요. 캡·운영 자금 안에서만 입찰합니다.
        </Muted>
        <Row>
          <Muted>샐러리캡(예상)</Muted>
          <Text style={{ color: projected > LEAGUE_CAP ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(projected)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
        <Row>
          <Muted>운영 자금(정산 후 · 연봉+보상금 차감)</Muted>
          <Text style={{ color: budgetCash - signedCost - pv.compCash < 0 ? theme.bad : theme.text, fontWeight: '800' }}>
            {formatMoney(Math.max(0, budgetCash - signedCost - pv.compCash))} / {formatMoney(budgetCash)}
          </Text>
        </Row>
        <Pressable
          onPress={() => busy.run('협상 테이블을 차리는 중…', () => setAggressive(!faAggressive))}
          style={[styles.toggle, faAggressive && { borderColor: theme.warn, backgroundColor: theme.warn + '20' }]}
        >
          <Text style={{ color: faAggressive ? theme.warn : theme.muted, fontWeight: '800' }}>
            공격적 영입 {faAggressive ? 'ON' : 'OFF'} (연봉 +20% 제시 → 경쟁 우위)
          </Text>
        </Pressable>
      </Card>

      <Button label="신인 드래프트로 →" onPress={() => router.push('/draft')} />

      {(compNeeded > 0 || moneyOnlyCount > 0) ? (
        <Card accent={theme.warn}>
          <Pressable onPress={() => setInfo('comp')} style={styles.compHeader}>
            <Ionicons name="help-circle-outline" size={16} color={theme.sky} />
            <Text style={{ color: theme.sky, fontSize: 12, fontWeight: '800' }}>보상선수 · '돈만'이 뭔가요?</Text>
          </Pressable>
          {compNeeded > 0 ? (
            <>
              <Text style={{ color: theme.warn, fontSize: 13, fontWeight: '700' }}>
                A/B 영입 {compNeeded}명 → 보호명단 밖 {compNeeded}명이 원소속팀으로 갑니다.
              </Text>
              {projectedCompName ? <Muted style={{ fontSize: 12 }}>현재 보상 1순위: {projectedCompName}</Muted> : null}
            </>
          ) : null}
          {moneyOnlyCount > 0 ? (
            <Text style={{ color: theme.good, fontSize: 13, fontWeight: '700' }}>
              '돈만' {moneyOnlyCount}명 → 선수단 보호(보상선수 없음), 보상금 가중(A 300%·B 200%).
            </Text>
          ) : null}
          {pv.compCash > 0 ? <Muted style={{ fontSize: 12, color: theme.warn }}>보상금 {formatMoney(pv.compCash)} 추가 차감</Muted> : null}
        </Card>
      ) : null}

      <Title>보호선수 명단 ({protectedIds.length}/{PROTECT_COUNT})</Title>
      <Muted style={{ fontSize: 12, lineHeight: 17 }}>
        보호하지 않은 선수 중 <Text style={{ color: theme.text, fontWeight: '700' }}>OVR이 가장 높은 선수부터</Text> 상대팀이
        보상선수로 데려갑니다. 주전을 지키세요. (외국인은 1년 계약이라 보상 대상이 아니라 제외)
      </Muted>
      {protectList.map((p) => {
        const prot = protectedIds.includes(p.id);
        return (
          <Pressable
            key={p.id}
            onPress={() => busy.run('협상 테이블을 차리는 중…', () => toggleProtect(p.id))}
            style={[styles.protectRow, prot && { borderColor: theme.good, backgroundColor: theme.good + '18' }]}
          >
            <PosTag pos={p.position} />
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.age}>{p.age}세</Text>
            <RoleBadge role={roleOf[p.id]} />
            <OvrBadge value={overallRaw(p)} />
            <Text style={{ color: prot ? theme.good : theme.muted, fontWeight: '800', width: 30, textAlign: 'right' }}>
              {prot ? '보호' : '—'}
            </Text>
            {/* 검사용 — 선수 상세로. hitSlop으로 터치 영역을 넓혀 보호 토글 오탭과 분리(행 탭=보호, 이 아이콘=상세) */}
            <Pressable onPress={() => router.push(`/player/${p.id}`)} hitSlop={10} style={styles.infoBtn}>
              <Ionicons name="information-circle-outline" size={20} color={theme.muted} />
            </Pressable>
          </Pressable>
        );
      })}

      <Title>FA 시장 ({poolPlayers.length}명)</Title>
      {/* 실시간 재계산 안내(§2.8.9 #4) — 아래 배지·계약 가능성은 모두 현재 오퍼 기준 예상 결과. */}
      <Muted style={{ fontSize: 12, lineHeight: 17 }}>
        현재 오퍼 기준으로 계산된 예상 결과입니다. 오퍼를 변경하면 예상 결과도 함께 다시 계산됩니다.
      </Muted>
      {poolPlayers.length === 0 ? (
        <Card><Muted>이번 오프시즌 풀린 FA가 없습니다.</Muted></Card>
      ) : (
        poolPlayers.map((p) => {
          const grade = grades.get(p.id)!;
          // 요구연봉 = 시장가×등급 프리미엄 × 사고 평판 할인(엔진 resolveFAMarket :150과 동일 산식).
          const ask = round100(askingPrice(marketVal(p), grade) * (repMap.get(p.id) ?? 1));
          const targeted = faSignings.includes(p.id);
          const won = pv.signedByMe.has(p.id);
          const lost = pv.lostTo[p.id];
          // 예상형 배지(§2.8.9 #2·#3) — 이 화면은 "협상(미리보기) 진행 중". 확정 표현("뺏김"·"영입 성공")·순위 숫자
          //   ("협상 N위")를 없애고 "현재 예상 — …" 톤으로. 게이트(CASH/CAP/ROSTER)는 사실이라 유지(어조만 완화).
          const comp = pv.faCompete[p.id];
          const winProb = comp?.winProb;                 // 예상 승자 수락 확률(이미 계산됨) — #5 계약 가능성 코스
          const countered = pv.counterFired[p.id];       // 카운터 발동(§2.8.6) — 내 오퍼가 요구를 수용해 상향된 케이스
          let badge: { t: string; c: string } | null = null;
          if (won) badge = countered
            ? { t: `현재 예상. 요구를 수용해 ${formatMoney(countered.to)}에 계약이 유력합니다`, c: theme.good }
            : { t: '현재 예상. 우리 팀 계약이 유력합니다', c: theme.good };
          else if (targeted) {
            const code = pv.faFail[p.id];
            const lostName = getTeam(lost)?.name ?? shortTeam(lost);
            if (code === 'LOST') badge = { t: `현재 예상. ${lostName}와 계약 가능성이 가장 높습니다`, c: theme.warn };
            else if (code === 'CASH') badge = { t: '운영 자금이 부족해 아직 제안하지 못했습니다', c: theme.warn };
            else if (code === 'CAP') badge = { t: '샐러리캡이 부족해 아직 제안하지 못했습니다', c: theme.warn };
            else if (code === 'ROSTER') badge = { t: '정원이 가득 차 아직 제안하지 못했습니다', c: theme.warn };
            else if (code === 'SIT_OUT') badge = { t: '현재 예상. 어느 구단과도 계약하지 않을 것으로 보입니다', c: theme.muted };
            else badge = { t: '제안 전달됨. 시즌 시작 때 결과가 확정됩니다', c: theme.sky };
          }
          // #5 계약 가능성(코스) — 예상 승자 prob를 높음/보통/낮음으로(정확 % 대신 우세 정도). 지명+승자 있을 때만.
          const chance = (targeted && (won || pv.faFail[p.id] === 'LOST' || pv.faFail[p.id] === 'SIT_OUT') && winProb !== undefined)
            ? (winProb >= 0.7 ? { t: '높음', c: theme.good } : winProb >= 0.4 ? { t: '보통', c: theme.warn } : { t: '낮음', c: theme.bad })
            : null;
          return (
            <View key={p.id} style={styles.row}>
              <Pressable
                style={styles.info}
                onPress={p.isForeign ? undefined : () => setOpenId((cur) => (cur === p.id ? null : p.id))}
              >
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {p.name} <Text style={{ color: theme.accent }}>{grade}</Text>
                    {p.isForeign ? <Text style={{ color: theme.bad }}> 외</Text> : null}
                  </Text>
                  <Text style={styles.sub}>
                    {p.age}세 · 요구 {formatMoney(ask)}
                    {needsCompensationPlayer(grade) ? ' · 보상선수' : ''}
                    {!p.isForeign ? (openId === p.id ? ' · 접기 ▲' : ' · 오퍼 만들기 ▼') : ''}
                  </Text>
                  {/* 우리 팀 친구/라이벌 — 영입 확률 판단 정보(RELATIONSHIP_SYSTEM) */}
                  {(() => {
                    if (p.isForeign) return null;
                    const rel = teamRelations(p.id, my, bonds);
                    if (!rel.friends.length && !rel.rivals.length) return null;
                    return (
                      <Text style={{ fontSize: 11, marginTop: 2 }}>
                        {rel.friends.length ? <Text style={{ color: theme.good }}>친한 {rel.friends.map((f) => f.name).join(', ')}</Text> : null}
                        {rel.friends.length && rel.rivals.length ? <Text style={{ color: theme.muted }}>  ·  </Text> : null}
                        {rel.rivals.length ? <Text style={{ color: theme.bad }}>라이벌 {rel.rivals.map((r) => r.name).join(', ')}</Text> : null}
                      </Text>
                    );
                  })()}
                  {badge ? <AnimatedBadge text={badge.t} color={badge.c} /> : null}
                  {/* #5 계약 가능성(코스) — 예상이 얼마나 우세한지. 정확 %는 숨기고 높음/보통/낮음만. */}
                  {chance ? (
                    <Text style={{ fontSize: 11, fontWeight: '800', marginTop: 2, color: chance.c }}>
                      계약 가능성 {chance.t}
                    </Text>
                  ) : null}
                  {/* #9 현재 제안 요약 — 내가 이 선수에게 넣은 오퍼(faOffers) 한 줄. 지명한 국내 FA만. */}
                  {targeted && !p.isForeign ? (() => {
                    const o = faOffers[p.id];
                    if (!o) return null;
                    const sal = resolveMyOfferSalary(o, ask);
                    const compLabel = needsCompensationPlayer(grade)
                      ? (moneyOnlyIds.includes(p.id) ? '돈만' : '보상선수+현금')
                      : '보상 없음';
                    return (
                      <Text style={styles.offerSummary} numberOfLines={1}>
                        현재 제안 · 연봉 {formatMoney(sal)} · {o.years}년 · 주전보장 {o.starterGuarantee ? 'O' : 'X'} · 보상 {compLabel}
                      </Text>
                    );
                  })() : null}
                </View>
                <OvrBadge value={overallRaw(p)} />
                {!p.isForeign ? (
                  <Ionicons name={openId === p.id ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={theme.muted} />
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => {
                  // '영입 시도' 시 오퍼 만들기 아코디언 자동 펼침(§2.8.8 ① — 국내 FA만, 지명 취소엔 미적용)
                  if (!targeted && !p.isForeign) setOpenId(p.id);
                  busy.run('협상 테이블을 차리는 중…', () => (targeted ? unsignFA(p.id) : signFA(p.id)));
                }}
                style={[
                  styles.btn,
                  { borderColor: targeted ? theme.bad : theme.accent, backgroundColor: targeted ? theme.bad + '22' : theme.accent + '22' },
                ]}
              >
                <Text style={[styles.btnText, { color: targeted ? theme.bad : theme.accent }]}>
                  {targeted ? '제안 취소' : '영입 제안'}
                </Text>
              </Pressable>
              {/* 지명은 시즌 시작 시 확정되는 예약(§2.8.8 ③·§2.8.9 #6) — 취소 시 예산·캡 즉시 반환 안내 */}
              {targeted ? (
                <Text style={styles.cancelHint}>제안을 취소하면 예산과 샐러리캡이 즉시 반환됩니다. 시즌 시작 전까지 다시 제안할 수 있습니다.</Text>
              ) : null}
              {/* A/B FA만 — 보상선수 대신 보상금만 내고 선수단 보호 */}
              {targeted && needsCompensationPlayer(grade) ? (
                <>
                  <Pressable
                    onPress={() => busy.run('협상 테이블을 차리는 중…', () => toggleMoneyOnly(p.id))}
                    style={[styles.btn, moneyOnlyIds.includes(p.id)
                      ? { borderColor: theme.good, backgroundColor: theme.good + '22' }
                      : { borderColor: theme.border }]}
                  >
                    <Text style={[styles.btnText, { color: moneyOnlyIds.includes(p.id) ? theme.good : theme.muted }]}>
                      {moneyOnlyIds.includes(p.id) ? `✓ 돈만 보상 (${grade === 'A' ? '300' : '200'}%)` : '보상선수 보호 (돈만)'}
                    </Text>
                  </Pressable>
                  {/* '돈만' 인라인 설명(§2.8.8 ② — §2.2~2.3·§253 '돈만'(선수단 보호) 용어 일치) */}
                  <Text style={styles.moneyOnlyHint}>
                    비보호 선수 1명을 내주는 대신 보상금을 더 내고(A 300%·B 200%) 선수단을 지킵니다.
                  </Text>
                </>
              ) : null}
              {/* 상세 펼침(오퍼 폼) — 관전형 옵트인(§2.8.4): 펼친 국내 FA에게만. 아무것도 안 만지면 위 '영입 시도'(자동 오퍼)로 그대로 동작. */}
              {openId === p.id && !p.isForeign ? (() => {
                const draft: FAOffer = drafts[p.id] ?? faOffers[p.id] ?? DEFAULT_FA_OFFER;
                const ratings = deriveRatings(p);
                const myRosterIds = base.off.rosters[my] ?? [];
                // 만족도 — 엔진 offerScore→acceptProb 위임(재구현 X). 재료는 pv와 동일한 base.off(pre-FA)에서.
                const sat = offerSatisfaction({
                  player: p, myTeam: my, snapshot: preSnap, myRosterIds,
                  prevTeamOf: base.prevTeamOf, prestige: base.prestige[my] ?? 0,
                  grade, repMult: repMap.get(p.id) ?? 1, offer: draft,
                  talkBias: ownerFx.offerBias[p.id], bonds: bondsCtx,
                });
                const bounds = offerSalaryBounds(ask, p, myPayroll);
                const curSalary = typeof draft.salary === 'number' ? draft.salary : ask; // 'auto' → 요구연봉 표시
                const maxYears = capContractYears(p.age, 5);
                const setDraft = (patch: Partial<FAOffer>) =>
                  setDrafts((d) => ({ ...d, [p.id]: { ...draft, ...patch } }));
                const pct = Math.round(sat.prob * 100);
                const tier = pct >= 80 ? { t: '매우 높음', c: theme.good } : pct >= 55 ? { t: '높음', c: theme.good }
                  : pct >= 30 ? { t: '보통', c: theme.warn } : { t: '낮음', c: theme.bad };
                const capRoom = LEAGUE_CAP - myPayroll;
                return (
                  <View style={styles.detail}>
                    {/* 능력 */}
                    <Text style={styles.detailHead}>능력</Text>
                    <StatBar label="스파이크" value={ratings.spike} reveal={reveal} />
                    <StatBar label="블로킹" value={ratings.block} reveal={reveal} />
                    <StatBar label="디그" value={ratings.dig} reveal={reveal} />
                    <StatBar label="리시브" value={ratings.receive} reveal={reveal} />
                    <StatBar label="세팅" value={ratings.set} reveal={reveal} />
                    <StatBar label="서브" value={ratings.serve} reveal={reveal} />
                    {p.seasonLines && p.seasonLines.length ? (
                      <>
                        <Text style={styles.detailHead}>최근 성적</Text>
                        {p.seasonLines.slice(-2).reverse().map((l) => (
                          <Text key={l.season} style={styles.seasonLine}>
                            {seasonYear(l.season)} · {shortTeam(l.teamId)} · {repRecordLine(p.position, l)}
                          </Text>
                        ))}
                      </>
                    ) : null}

                    {/* 이적 성향(성향 별점) — 스카우팅 낮으면 ??? 안개 */}
                    <View style={styles.detailHeadRow}>
                      <Text style={styles.detailHead}>이적 성향</Text>
                      <Text style={styles.revealHint}>스카우팅 {Math.round(reveal * 100)}%</Text>
                    </View>
                    {reveal >= REVEAL_PRECISE ? (
                      PREF_STAR_AXES.map((ax) => (
                        <StarRow key={ax.key} label={ax.label} weight={prefWeightsOf(p)[ax.key] ?? 0} />
                      ))
                    ) : (
                      <>
                        {PREF_STAR_AXES.map((ax) => <StarRow key={ax.key} label={ax.label} fog />)}
                        {/* #8 성향 ??? 안내 — 정밀 임계(REVEAL_PRECISE=0.92) 명시. 스카우터 영입으로 도달. */}
                        <Muted style={{ fontSize: 11, marginTop: 2, lineHeight: 15 }}>
                          이 선수의 이적 성향은 현재 스카우팅 정보가 부족하여 확인할 수 없습니다.
                          스카우팅 {Math.round(REVEAL_PRECISE * 100)}% 이상 달성 시 공개됩니다.
                        </Muted>
                      </>
                    )}

                    {/* 오퍼 폼 */}
                    <Text style={styles.detailHead}>오퍼</Text>
                    <Stepper
                      label="연봉"
                      display={formatMoney(curSalary)}
                      decOff={curSalary <= bounds.min}
                      incOff={curSalary >= bounds.max}
                      onDec={() => setDraft({ salary: Math.max(bounds.min, curSalary - bounds.step) })}
                      onInc={() => setDraft({ salary: Math.min(bounds.max, curSalary + bounds.step) })}
                    />
                    <Stepper
                      label="기간"
                      display={`${draft.years}년`}
                      decOff={draft.years <= 1}
                      incOff={draft.years >= maxYears}
                      onDec={() => setDraft({ years: Math.max(1, draft.years - 1) as FAOffer['years'] })}
                      onInc={() => setDraft({ years: Math.min(maxYears, draft.years + 1) as FAOffer['years'] })}
                    />
                    <Pressable
                      onPress={() => setDraft({ starterGuarantee: !draft.starterGuarantee })}
                      style={[styles.guarToggle, draft.starterGuarantee && { borderColor: theme.good, backgroundColor: theme.good + '18' }]}
                    >
                      <Text style={{ color: draft.starterGuarantee ? theme.good : theme.muted, fontWeight: '800', fontSize: 13 }}>
                        주전 보장 {draft.starterGuarantee ? 'ON' : 'OFF'}
                      </Text>
                      <Text style={{ color: theme.muted, fontSize: 11, marginTop: 1 }}>약속하고 벤치에 앉히면 불만·팬심·재계약 거부로 돌아옵니다.</Text>
                    </Pressable>
                    <Muted style={{ fontSize: 11 }}>
                      캡 여유 {formatMoney(Math.max(0, capRoom))}{maxYears < 5 ? ` · 나이 상 기간 최대 ${maxYears}년` : ''}
                    </Muted>
                    {/* 선수 역제안 카운터 한도(FA_SYSTEM §2.8.6) — counterAsk·δ는 은닉, 한도만 노출. +0=미설정(0드리프트). */}
                    {(() => {
                      const up = draft.counterTolerance?.salaryUp ?? 0;
                      return (
                        <>
                          <Stepper
                            label="추가 요구 양보"
                            display={up > 0 ? `+${formatMoney(up)}` : '설정 안 함'}
                            decOff={up <= 0}
                            incOff={up >= COUNTER_MAX}
                            onDec={() => { const v = Math.max(0, up - COUNTER_STEP); setDraft({ counterTolerance: v > 0 ? { salaryUp: v } : undefined }); }}
                            onInc={() => { const v = Math.min(COUNTER_MAX, up + COUNTER_STEP); setDraft({ counterTolerance: { salaryUp: v } }); }}
                          />
                          <Muted style={{ fontSize: 11, lineHeight: 15 }}>
                            {up > 0
                              ? '선수가 더 요구하면 이 한도 안에서 자동으로 받아들입니다.'
                              : '선수가 더 나은 대우를 요구할 때 여기까지 양보할 한도를 정해두세요.'}
                          </Muted>
                        </>
                      );
                    })()}

                    {/* 실시간 선수 만족도 — 성공률 아님(§2.8.4 ②) */}
                    <View style={styles.satHead}>
                      <Text style={styles.detailHead}>선수 만족도</Text>
                      <Text style={{ color: tier.c, fontWeight: '900', fontSize: 15 }}>{pct}% · {tier.t}</Text>
                    </View>
                    <View style={styles.satBarBg}>
                      <View style={[styles.satBarFill, { width: `${pct}%`, backgroundColor: tier.c }]} />
                    </View>
                    <Muted style={{ fontSize: 11, lineHeight: 16 }}>
                      내 오퍼만 보고 이 선수가 얼마나 끌리는지예요. 다른 구단과의 경쟁에서 이길지(영입 성공/실패)는
                      시즌이 시작될 때 확정됩니다.
                    </Muted>

                    {/* 경쟁 구단 + 계약 가능성 + 우세 이유(§2.8.5·§2.8.9 #3·#5·#7) — 금액·순위 숫자 비공개, pv(=엔진 해소)에서만 */}
                    {(() => {
                      const comp = pv.faCompete[p.id];
                      const rivals = (comp?.bidders ?? []).filter((t) => t !== my);
                      // #5 계약 가능성(코스) — 순위 숫자 대신. 예상 승자 prob를 높음/보통/낮음으로.
                      const wp = comp?.winProb;
                      const tierC = wp === undefined ? null
                        : wp >= 0.7 ? { t: '높음', c: theme.good } : wp >= 0.4 ? { t: '보통', c: theme.warn } : { t: '낮음', c: theme.bad };
                      // #7 우세 이유 — 예상 승자가 우세한 실제 offerScore 상위 동기(엔진이 계산). 성향 정밀 게이트(스카우팅) 통과 시만.
                      const factors = comp?.winFactors;
                      const winnerName = won ? '우리 팀' : (pv.faFail[p.id] === 'LOST' ? (getTeam(lost)?.name ?? shortTeam(lost)) : null);
                      const showFactors = reveal >= REVEAL_PRECISE && !!factors?.length && !!winnerName;
                      return (
                        <View style={styles.competBox}>
                          <Text style={styles.detailHead}>경쟁 구단</Text>
                          {rivals.length ? (
                            <Text style={styles.competText}>
                              관심 구단 {rivals.length}곳 ({rivals.map((t) => getTeam(t)?.name ?? shortTeam(t)).join(', ')})
                            </Text>
                          ) : (
                            <Muted style={{ fontSize: 12 }}>아직 관심을 보인 다른 구단이 없습니다.</Muted>
                          )}
                          {targeted && tierC ? (
                            <>
                              <Text style={[styles.competRank, { color: tierC.c }]}>계약 가능성 {tierC.t}</Text>
                              <Muted style={{ fontSize: 11, marginTop: 1, lineHeight: 15 }}>
                                가장 앞서 있어도 확정은 아니에요. 선수가 시즌 시작 때 최종 선택합니다.
                              </Muted>
                            </>
                          ) : null}
                          {showFactors ? (
                            <Text style={styles.competText}>
                              현재 {winnerName}가 우세한 이유 · {factors!.join(' · ')}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })()}

                    <Pressable
                      onPress={() => busy.run('협상 테이블을 차리는 중…', () => {
                        setOffer(p.id, draft);
                        // 성공 피드백(2026-07-11 무피드백 스윕 #2) — 경쟁 뒤집힘 토스트(#81)는 변화 때만 떠서 단순 갱신이 조용했다
                        toast.push(`${p.name}, 오퍼를 ${targeted ? '갱신했습니다' : '냈습니다'}. 결과는 시즌 시작 때 확정됩니다.`);
                      })}
                      style={[styles.applyBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}
                    >
                      <Text style={{ color: theme.accent, fontWeight: '800', fontSize: 14 }}>
                        {targeted ? '이 오퍼로 갱신' : '이 오퍼로 영입 시도'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })() : null}
            </View>
          );
        })
      )}
      <BusyOverlay visible={busy.busy} message={busy.message} />

      {/* 개념 안내 모달(UI-21 — 커스텀 다크 글래스, 네이티브 Alert 금지) */}
      <Popup visible={info !== null} onRequestClose={() => setInfo(null)} dismissable>
        {info === 'delay' ? (
          <>
            <Text style={styles.modalTitle}>지금은 '영입 제안' 단계예요</Text>
            <Text style={styles.modalBody}>
              영입 제안은 <Text style={styles.modalStrong}>곧바로 계약이 아니라 '제안(오퍼)'</Text>입니다.
              내가 제안한 선수들의 최종 결과는 <Text style={styles.modalStrong}>시즌이 시작될 때</Text> 한 번에 확정됩니다.
            </Text>
            <Text style={styles.modalBody}>
              그때 선수는 우리 팀만이 아니라 <Text style={styles.modalStrong}>관심 있는 다른 구단의 제안까지 비교</Text>해
              한 팀을 고릅니다. 그래서 제안해도:
            </Text>
            <Text style={styles.modalBullet}>· 다른 구단에 뺏길 수 있고(경쟁 입찰)</Text>
            <Text style={styles.modalBullet}>· 마음에 드는 제안이 없으면 선수가 어느 구단과도 계약하지 않을 수 있고</Text>
            <Text style={styles.modalBullet}>· 우리 캡·운영 자금이 부족하면 입찰조차 못 합니다</Text>
            <Text style={styles.modalBody}>
              결과가 나오면 각 선수 카드에 <Text style={styles.modalStrong}>왜 됐는지/안 됐는지</Text>가 사유로 표시됩니다.
            </Text>
          </>
        ) : info === 'comp' ? (
          <>
            <Text style={styles.modalTitle}>보상선수 · '돈만' 보상</Text>
            <Text style={styles.modalBody}>
              <Text style={styles.modalStrong}>A·B 등급 FA</Text>를 영입하면, 그 선수의 원소속팀이
              우리 팀 <Text style={styles.modalStrong}>비보호 선수 1명</Text>을 보상선수로 데려갑니다.
              좋은 선수를 얻는 대신 우리 선수 하나를 내주는 거예요.
            </Text>
            <Text style={styles.modalBody}>
              <Text style={styles.modalStrong}>보호선수 명단(6명)</Text>에 넣은 선수는 안전합니다.
              명단 밖에서 <Text style={styles.modalStrong}>OVR이 가장 높은 선수부터</Text> 넘어가니 주전을 지키세요.
            </Text>
            <Text style={styles.modalBody}>
              <Text style={{ color: theme.good, fontWeight: '800' }}>'돈만' 보상</Text>을 켜면 보상선수 없이
              돈을 더 내고(A 300%·B 200%) 우리 선수단을 <Text style={styles.modalStrong}>그대로 지킵니다</Text>.
              부자 구단이 핵심 선수를 지킬 때 쓰는 옵션이에요.
            </Text>
            <Text style={styles.modalBody}>
              <Text style={styles.modalStrong}>C 등급 FA</Text>는 보상이 없어 '돈만' 옵션이 뜨지 않습니다.
            </Text>
          </>
        ) : null}
        <Pressable onPress={() => setInfo(null)} style={styles.modalClose}>
          <Text style={styles.modalCloseTxt}>확인</Text>
        </Pressable>
      </Popup>
    </Screen>
  );
}

/** 성향 별점 한 줄 — 가중치를 ★1~5로. fog=스카우팅 낮아 ??? 안개. */
function StarRow({ label, weight, fog }: { label: string; weight?: number; fog?: boolean }) {
  const n = fog ? 0 : starsFromWeight(weight ?? 0);
  return (
    <View style={styles.starRow}>
      <Text style={styles.starLabel}>{label}</Text>
      {fog ? (
        <Text style={[styles.stars, { color: theme.muted }]}>? ? ?</Text>
      ) : (
        <Text style={styles.stars}>
          <Text style={{ color: theme.accent }}>{'★'.repeat(n)}</Text>
          <Text style={{ color: theme.border }}>{'★'.repeat(5 - n)}</Text>
        </Text>
      )}
    </View>
  );
}

/** −/＋ 스텝퍼(연봉·기간) */
function Stepper({ label, display, onDec, onInc, decOff, incOff }: {
  label: string; display: string; onDec: () => void; onInc: () => void; decOff?: boolean; incOff?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable onPress={onDec} disabled={decOff} hitSlop={6} style={[styles.stepBtn, decOff && styles.stepBtnOff]}>
        <Text style={styles.stepBtnTxt}>−</Text>
      </Pressable>
      <Text style={styles.stepVal}>{display}</Text>
      <Pressable onPress={onInc} disabled={incOff} hitSlop={6} style={[styles.stepBtn, incOff && styles.stepBtnOff]}>
        <Text style={styles.stepBtnTxt}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.border },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
  cancelHint: { color: theme.muted, fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: -4 },
  moneyOnlyHint: { color: theme.muted, fontSize: 11, lineHeight: 15, marginTop: -4 },
  toggle: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', marginTop: 4 },
  protectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  age: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  infoBtn: { paddingLeft: 2 },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: theme.sky + '14', borderRadius: 12, borderWidth: 1, borderColor: theme.sky + '40',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  noticeTitle: { color: theme.text, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  noticeText: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  offerSummary: { color: theme.muted, fontSize: 11, fontWeight: '700', marginTop: 3 },
  compHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  modalTitle: { color: theme.text, fontSize: 19, fontWeight: '900' },
  modalBody: { color: theme.muted, fontSize: 13, lineHeight: 20 },
  modalStrong: { color: theme.text, fontWeight: '800' },
  modalBullet: { color: theme.muted, fontSize: 13, lineHeight: 20, marginLeft: 2 },
  modalClose: {
    backgroundColor: theme.accentGlass, borderColor: theme.accent, borderWidth: 1.5,
    borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 2,
  },
  modalCloseTxt: { color: theme.accent, fontSize: 15, fontWeight: '800' },
  // ── 상세 펼침(오퍼 폼) §2.8.4 ──
  detail: {
    borderTopWidth: 1, borderTopColor: theme.border, marginTop: 2, paddingTop: 10, gap: 6,
  },
  detailHead: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 6 },
  detailHeadRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  revealHint: { color: theme.muted, fontSize: 11, marginBottom: 1 },
  seasonLine: { color: theme.text, fontSize: 12, fontWeight: '600' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starLabel: { color: theme.muted, fontSize: 13, width: 44 },
  stars: { fontSize: 15, letterSpacing: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepLabel: { color: theme.text, fontSize: 13, fontWeight: '700', width: 44 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: theme.accent,
    backgroundColor: theme.accent + '18', alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { borderColor: theme.border, backgroundColor: 'transparent' },
  stepBtnTxt: { color: theme.text, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  stepVal: { color: theme.text, fontSize: 14, fontWeight: '800', flex: 1, textAlign: 'center' },
  guarToggle: {
    borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginTop: 2,
  },
  satHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  satBarBg: { height: 10, borderRadius: 5, backgroundColor: theme.border, overflow: 'hidden' },
  satBarFill: { height: 10, borderRadius: 5 },
  competBox: { marginTop: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  competText: { color: theme.text, fontSize: 12, lineHeight: 17, marginTop: 2 },
  competRank: { color: theme.accent, fontSize: 13, fontWeight: '900', marginTop: 6 },
  applyBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
}));

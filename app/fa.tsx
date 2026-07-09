import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, IconLabel, Loading, Muted, OvrBadge, PosTag, Row, Screen, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { RoleBadge } from '../components/RoleBadge';
import { Popup } from '../components/Popup';
import { BusyOverlay, useBusyRun } from '../components/BusyOverlay';
import { shortTeamName as shortTeam } from '../data/league';
import { seasonYear } from '../data/seasonLabel';
import { buildOffseasonBase, scandalRepMap } from '../data/offseason';
import { resolveFAPreviewFor } from '../data/offseasonArgs';
import { buildOwnerFx } from '../data/owner';
import { projectSettledCash } from '../data/financeProjection';
import { LEAGUE_CAP } from '../engine/cap';
import { needsCompensationPlayer, pickCompensation, PROTECT_COUNT } from '../engine/compensation';
import { assignFAGrades, askingPrice } from '../engine/faMarket';
import { buildLineup } from '../engine/lineup';
import { ALL_POSITIONS, overall, overallRaw } from '../engine/overall';
import { formatMoney } from '../engine/salary';
import { marketVal } from '../data/awardSalary';
import { teamRelations } from '../data/relationships';
import { useGameStore } from '../store/useGameStore';

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

  // 이번 시즌 정산 후 운영 자금 — endSeason이 FA에 쓰는 실제 지갑(모기업 지원·관중 수입 반영).
  //   store.cash(직전 정산값)로 미리보기하면 모기업 지원(14~28억)이 빠져 "영입 불가"로 오표시된다.
  const budgetCash = useMemo(
    () => projectSettledCash(my, season, cash, fanScore, archive),
    [my, season, cash, fanScore, archive],
  );

  // 경쟁 결과 미리보기(결정론) — 영입 성공/실패 예상.
  // endSeason과 동일한 ownerFx(면담·불만 거부)+정산 후 운영 자금을 넣어야 미리보기=결과가 보장된다.
  // 스냅샷/해결 분리(REALTIME_SIM §7.3): 무거운 롤오버 base는 안정 deps로 메모, 영입/보호/돈만/공격적 토글은 가벼운 해결만 재실행.
  const ownerFx = useMemo(() => buildOwnerFx(interviews, season, my, fanScore), [interviews, season, my, fanScore]);
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
    <Screen title={`${seasonYear(season)} → ${seasonYear(season + 1)} FA 시장`}>
      {/* 지연 구조 안내(항상 표시) — "지금은 지명, 결과는 시즌 시작 때 확정"을 상단에 못박아
          "영입 눌렀는데 실패"로 오해하는 걸 막는다(FA_SYSTEM §2.7 UX). */}
      <Pressable onPress={() => setInfo('delay')} style={styles.notice}>
        <Ionicons name="hourglass-outline" size={18} color={theme.sky} />
        <Text style={styles.noticeText}>
          지금은 선수를 <Text style={{ color: theme.text, fontWeight: '800' }}>'지명'</Text>하는 단계예요.
          최종 결과는 <Text style={{ color: theme.text, fontWeight: '800' }}>시즌이 시작될 때</Text> 다른 구단과의
          경쟁으로 확정됩니다. <Text style={{ color: theme.sky, fontWeight: '800' }}>자세히 ›</Text>
        </Text>
      </Pressable>

      <Card accent={theme.sky}>
        <Row>
          <IconLabel icon="person-add-outline" color={theme.sky}>영입 성공 / 지명</IconLabel>
          <Text style={{ color: theme.text, fontWeight: '800' }}>
            {pv.signedByMe.size} / {faSignings.length}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          지명해도 선수는 팀 전력·출전기회·충성도·연봉을 보고 결정합니다. 다른 구단과 경합에서
          질 수도, 선수가 잔류를 택할 수도 있어요. 캡·운영 자금 안에서만 입찰합니다.
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
          // 실패 사유 세분화(FA_SYSTEM §2.7 UX) — '경합/불발' 뭉뚱그림 제거. 엔진이 준 게이트 코드로 사유별 표기.
          //   자금/캡/정원은 "입찰 자체가 안 들어간" 경우라 타팀이 뽑아도(lostTo) '뺏김'이 아니라 그 사유로 보여준다.
          let badge: { t: string; c: string } | null = null;
          if (won) badge = { t: '영입 성공', c: theme.good };
          else if (targeted) {
            const code = pv.faFail[p.id];
            if (code === 'LOST') badge = { t: `${shortTeam(lost)}에 뺏김 (경쟁 입찰 패배)`, c: theme.bad };
            else if (code === 'CASH') badge = { t: '운영 자금 부족 — 입찰 못 함', c: theme.warn };
            else if (code === 'CAP') badge = { t: '샐러리캡 초과 — 입찰 못 함', c: theme.warn };
            else if (code === 'ROSTER') badge = { t: '선수 자리 없음 — 정원 초과', c: theme.warn };
            else if (code === 'SIT_OUT') badge = { t: `${p.name} 선수가 잔류를 택함`, c: theme.muted };
            else badge = { t: '지명함 — 시즌 시작 때 확정', c: theme.sky };
          }
          return (
            <View key={p.id} style={styles.row}>
              <View style={styles.info}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {p.name} <Text style={{ color: theme.accent }}>{grade}</Text>
                    {p.isForeign ? <Text style={{ color: theme.bad }}> 외</Text> : null}
                  </Text>
                  <Text style={styles.sub}>
                    {p.age}세 · 요구 {formatMoney(ask)}
                    {needsCompensationPlayer(grade) ? ' · 보상선수' : ''}
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
                  {badge ? <Text style={{ color: badge.c, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{badge.t}</Text> : null}
                </View>
                <OvrBadge value={overallRaw(p)} />
              </View>
              <Pressable
                onPress={() => busy.run('협상 테이블을 차리는 중…', () => (targeted ? unsignFA(p.id) : signFA(p.id)))}
                style={[
                  styles.btn,
                  { borderColor: targeted ? theme.bad : theme.accent, backgroundColor: targeted ? theme.bad + '22' : theme.accent + '22' },
                ]}
              >
                <Text style={[styles.btnText, { color: targeted ? theme.bad : theme.accent }]}>
                  {targeted ? '취소' : '영입 시도'}
                </Text>
              </Pressable>
              {/* A/B FA만 — 보상선수 대신 보상금만 내고 선수단 보호 */}
              {targeted && needsCompensationPlayer(grade) ? (
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
              ) : null}
            </View>
          );
        })
      )}
      <BusyOverlay visible={busy.busy} message={busy.message} />

      {/* 개념 안내 모달(UI-21 — 커스텀 다크 글래스, 네이티브 Alert 금지) */}
      <Popup visible={info !== null} onRequestClose={() => setInfo(null)} dismissable>
        {info === 'delay' ? (
          <>
            <Text style={styles.modalTitle}>지금은 '지명' 단계예요</Text>
            <Text style={styles.modalBody}>
              영입 시도는 <Text style={styles.modalStrong}>곧바로 계약이 아니라 '지명'</Text>입니다.
              내가 지명한 선수들의 최종 결과는 <Text style={styles.modalStrong}>시즌이 시작될 때</Text> 한 번에 확정됩니다.
            </Text>
            <Text style={styles.modalBody}>
              그때 선수는 우리 팀만이 아니라 <Text style={styles.modalStrong}>관심 있는 다른 구단의 제안까지 비교</Text>해
              한 팀을 고릅니다. 그래서 지명해도:
            </Text>
            <Text style={styles.modalBullet}>· 다른 구단에 뺏길 수 있고(경쟁 입찰)</Text>
            <Text style={styles.modalBullet}>· 마음에 드는 제안이 없으면 선수가 잔류를 택할 수 있고</Text>
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

const styles = themedStyles(() => StyleSheet.create({
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.border },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
  toggle: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', marginTop: 4 },
  protectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  age: { color: theme.muted, fontSize: 13, fontWeight: '700' },
  infoBtn: { paddingLeft: 2 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.sky + '14', borderRadius: 12, borderWidth: 1, borderColor: theme.sky + '40',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  noticeText: { flex: 1, color: theme.muted, fontSize: 12, lineHeight: 17 },
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
}));

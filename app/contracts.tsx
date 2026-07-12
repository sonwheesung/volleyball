// 계약 관리 전용 화면 — 단장실 "계약 관리"에서 진입.
// 1행 = 선수 1명. 행을 누르면 재계약/방출 선택(액션시트). FA 예정·방출 선수도 여기서 처리.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { Card, IconLabel, Loading, Muted, OvrBadge, PosTag, Row, Screen, SCREEN_LOADING_MIN_MS, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { ActionSheet, Popup } from '../components/Popup';
import { getEvolvedTeamPlayers, getPlayer, evolveOnDay, LEAGUE } from '../data/league';
import { rosterIdsOnDay } from '../data/dynamics';
import { teamRelations } from '../data/relationships';
import { getPlayerProduction } from '../data/production';
import { displayCutoff } from '../data/standings';
import { activeRoster, capPayroll, payroll } from '../data/roster';
import { overallRaw } from '../engine/overall';
import { isFranchise, maxSalaryFor, LEAGUE_CAP } from '../engine/cap';
import { ROSTER_MIN, severanceFee } from '../engine/transactions';
import { assignFAGrades, willBeFA } from '../engine/faMarket';
import { contractStatus, formatMoney, resignSalaryBounds } from '../engine/salary';
import { capContractYears } from '../engine/retire';
import { marketVal } from '../data/awardSalary';
import { resignOutlookNow, resignCaptionOf, resignReactionCopy, type ResignBand } from '../data/owner';
import { useGameStore } from '../store/useGameStore';
import type { ReSignReject } from '../store/useGameStore';
import type { Contract, Player } from '../types';

const STATUS_COLOR = { 저평가: theme.good, 적정: theme.muted, 고평가: theme.bad } as const;
// 잔류 전망 밴드(FA §2.5c-보완 3단계) — 재계약 거부 확률(currentDay 파생)의 3구간. color·label 표시.
const BAND_META: Record<ResignBand, { label: string; color: string }> = {
  stable: { label: '안정', color: theme.good },
  fluid: { label: '유동', color: theme.warn },
  risk: { label: '위험', color: theme.bad },
};

// store reSign 거부 사유 → 사용자 문구(조용한 거부 제거). 사전체크가 못 잡은 잔여 케이스의 안전망.
function resignRejectMessage(p: Player, reason: ReSignReject): string {
  switch (reason) {
    case 'over-team-cap': return `${p.name} 재계약이 샐러리캡(${formatMoney(LEAGUE_CAP)})을 넘습니다. 방출/정리 후 시도하세요.`;
    case 'over-individual-cap': return `${p.name}의 연봉이 개인 상한(${formatMoney(maxSalaryFor(p))})을 넘습니다.`;
    case 'foreign': return '외국인 선수는 국내 재계약 대상이 아닙니다.';
    case 'not-on-roster': return `${p.name}은(는) 현재 로스터에 없어 재계약할 수 없습니다.`;
    case 'invalid-contract': return '계약 조건이 올바르지 않습니다.';
    default: return '재계약할 수 없습니다.';
  }
}

export default function Contracts() {
  // 계약 관리는 무겁다(전 로스터 진화 + 선수별 생산·시장가 집계). 한 틱 미뤄 로딩부터 그린다.
  const ready = useDeferredReady(SCREEN_LOADING_MIN_MS);
  if (!ready) return <Loading title="계약 관리" variant="list" />;
  return <ContractsInner />;
}

function ContractsInner() {
  const router = useRouter();
  const teamId = useGameStore((s) => s.selectedTeamId)!;
  const currentDay = useGameStore((s) => s.currentDay);
  const results = useGameStore((s) => s.results);
  const inSeasonTx = useGameStore((s) => s.inSeasonTx);
  const overrides = useGameStore((s) => s.contractOverrides);
  const released = useGameStore((s) => s.released);
  const resignDecisions = useGameStore((s) => s.resignDecisions);
  const reSign = useGameStore((s) => s.reSign);
  const release = useGameStore((s) => s.release);
  const unrelease = useGameStore((s) => s.unrelease);
  const setResign = useGameStore((s) => s.setResign);
  const cash = useGameStore((s) => s.cash);
  const bonds = useGameStore((s) => s.bonds);
  const interviews = useGameStore((s) => s.interviews);
  const season = useGameStore((s) => s.season);

  const evolved = getEvolvedTeamPlayers(teamId, currentDay);
  const active = activeRoster(evolved, overrides, released);
  // 계약 관리는 국내 전용 — 외인/아시아쿼터는 1년 트라이아웃 계약이라 방출·재계약·FA 비대상(FOREIGN_SYSTEM 3장).
  const roster = active.filter((p) => !p.isForeign).sort((a, b) => b.contract.salary - a.contract.salary);
  const foreigners = active.filter((p) => p.isForeign).sort((a, b) => overallRaw(b) - overallRaw(a));
  const total = payroll(roster);
  const releasedPlayers = released.map((id) => getPlayer(id)).filter((p): p is Player => !!p);
  const faList = roster.filter(willBeFA);
  // FA 등급은 **리그 전체 FA 예정 풀** 순위로 매긴다(assignFAGrades는 상대 순위 — 내 팀 부분집합으로 매기면
  //   1명일 때 무조건 A로 오표시). 오프시즌 풀 근사: 전 구단 현재 명단에서 willBeFA 국내 선수 수집(EC-FA-09 형제).
  const leagueFaGrades = useMemo(() => {
    const pool: Player[] = [];
    for (const t of LEAGUE.teams) {
      for (const p of getEvolvedTeamPlayers(t.id, currentDay)) {
        if (!p.isForeign && willBeFA(p)) pool.push(p);
      }
    }
    return assignFAGrades(pool);
  }, [currentDay]);
  const faGrades = leagueFaGrades;
  // 잔류 전망(FA §2.5c-보완 3단계) — resignOutlookNow(엔진 refuseResignProb+가산항 위임, currentDay 파생·미래 미시뮬).
  //   대기 override(인시즌 재계약) 연봉이 money 불만을 재평가하도록 overrides 전달. 위험(잔류 거부 확률 높음) 선수 먼저 정렬(만료 임박 강조).
  const faSorted = useMemo(
    () => faList
      .map((p) => ({ p, outlook: resignOutlookNow(p, teamId, currentDay, interviews, season, overrides) }))
      .sort((a, b) => b.outlook.prob - a.outlook.prob),
    [faList, teamId, currentDay, interviews, season, overrides],
  );
  // 시장가·저평가 라벨·재계약 오퍼 가격은 **표시 컷오프**(§3.3 displayCutoff) — player 상세와 동일 데이터 경로(이원화 해소, 2026-07-07).
  const displayDay = displayCutoff(currentDay, results, teamId);

  // 재계약 오퍼 빌더 열기(FA §2.5c-격상) — 3 프리셋을 FA식 슬라이더로. 기본값=표준(시장가·3년·보장off, 원탭 상당).
  const doResign = (p: Player) => {
    const market = marketVal(p, getPlayerProduction(p.id, displayDay));
    const b = resignSalaryBounds(p, market);
    const stdYears = capContractYears(p.age + 1, 3); // 표준=3년(정년 캡)
    setBuilder({ p, market, salary: b.standard, years: stdYears, guarantee: false });
  };
  // 오퍼 확정(빌더 '제안') → 캡 체크 후 확정 시트 오픈(캡 초과는 즉시 안내).
  // 사전체크 = store reSign 게이트와 **동일 규칙**(capPayroll §7 · TRANSACTION_SYSTEM §7의 6번째 사이트):
  //   그날 유효 명단(rosterIdsOnDay — 시즌 중 영입 포함·방출 제외)에 재계약 override(이 선수=새 오퍼)·시즌
  //   영입비(inSeasonCost)·배신 웃돈을 반영한다. 개인 상한(maxSalaryFor)·프랜차이즈 팀캡 예외까지 store와 일치.
  const pickOffer = (p: Player, contract: Contract, band: ResignBand, label: string, note: string) => {
    // ① 개인 연봉 상한(MAX_SALARY 8억 / 프랜차이즈 11억) — store 1차 게이트와 동일
    if (contract.salary > maxSalaryFor(p)) {
      showAlert('개인 연봉 상한 초과', `${p.name} ${label}(${formatMoney(contract.salary)})이 개인 상한(${formatMoney(maxSalaryFor(p))})을 넘습니다.`);
      return;
    }
    // ② 팀 캡 — 프랜차이즈 재계약은 팀캡 예외(store cd3d99a와 일치). 비프랜차이즈만 capPayroll로 하드 체크.
    if (!isFranchise(p)) {
      const myIds = rosterIdsOnDay(teamId, currentDay);
      const isBetrayed = (id: string) => inSeasonTx.some((t) => t.kind === 'release' && t.teamId === teamId && t.playerId === id);
      const inSeasonSigned = new Set(inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === teamId).map((t) => t.playerId));
      const capPlayers = myIds.map((id) => evolveOnDay(id, currentDay)).filter((pl): pl is Player => !!pl);
      const nextOverrides = { ...overrides, [p.id]: contract };
      if (capPayroll(capPlayers, nextOverrides, inSeasonSigned, isBetrayed) > LEAGUE_CAP) {
        showAlert('샐러리캡 초과', `${p.name} ${label}(${formatMoney(contract.salary)})이 캡(${formatMoney(LEAGUE_CAP)})을 넘습니다. 방출/정리 후 시도하세요.`);
        return;
      }
    }
    setBuilder(null);
    setConfirmSheet({ p, contract, band, label, note });
  };

  const doRelease = (p: Player) => {
    const fee = severanceFee(p.contract.salary, p.contract.remaining);
    // 위약금 지불 못 하면 방출 자체가 불가(재정 무게 — TRANSACTION_SYSTEM 0.5①)
    if (fee > cash) {
      showAlert('위약금 부족', `${p.name} 방출에는 위약금 ${formatMoney(fee)}가 듭니다.\n현재 운영 자금 ${formatMoney(cash)}. 지불할 수 없습니다.`);
      return;
    }
    // 함께한 세월·통산을 회고로(감정 무게 — TRANSACTION_SYSTEM 0.5②). 포지션별 대표 스탯.
    const c = p.career;
    const stat = p.position === 'L' ? `통산 디그 ${c.digs.toLocaleString()}`
      : p.position === 'S' ? `통산 세트 ${c.assists.toLocaleString()}`
      : `통산 ${c.points.toLocaleString()}점`;
    const retro = [
      p.clubTenure > 0 ? `우리 팀과 ${p.clubTenure}시즌` : '갓 합류한 선수',
      c.matches > 0 ? `${c.matches}경기 · ${stat}` : '아직 기록 없음',
      isFranchise(p) ? '프랜차이즈 스타' : null,
    ].filter(Boolean).join('\n');
    const heavy = isFranchise(p) || p.clubTenure >= 6;
    const tone = heavy ? '\n\n오래 팀을 지킨 선수입니다. 정말 보내시겠습니까?' : '';
    // 인간관계 경고(현재 사실 — RELATIONSHIP §3.2②·§6): 팀에 남는 각별한 동료는 방출에 동요(재계약 거부 위험↑).
    const friends = teamRelations(p.id, teamId, bonds).friends;
    // Alert는 josa 자동교정을 안 거치므로 주격조사(이/가) 병기를 피해 대시로 끊는다.
    const friendWarn = friends.length
      ? `\n\n💔 각별한 동료 ${friends.map((f) => f.name).join(', ')}. 방출에 동요할 수 있습니다 (재계약 거부 위험↑)`
      : '';
    showAlert(
      `${p.name} 방출`,
      `${retro}${friendWarn}\n\n위약금 ${formatMoney(fee)} 지불 · 연봉 ${formatMoney(p.contract.salary)} 절감\n(당일 철회 가능)${tone}`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '방출', style: 'destructive',
          onPress: () => { if (!release(p.id)) showAlert('방출 불가', `로스터 하한(${ROSTER_MIN}명) 또는 위약금(${formatMoney(fee)}) 문제로 방출할 수 없습니다.`); },
        },
      ],
    );
  };

  // 행을 누르면 처리 메뉴(1행 1선수) — 다크 글래스 액션시트(네이티브 흰 Alert 대체)
  const [manage, setManage] = useState<Player | null>(null);
  const [builder, setBuilder] = useState<{ p: Player; market: number; salary: number; years: number; guarantee: boolean } | null>(null);
  const [confirmSheet, setConfirmSheet] = useState<{ p: Player; contract: Contract; band: ResignBand; label: string; note: string } | null>(null);
  // 제안 직후 결과 피드백(FA §2.5c-격상 step3) — 선수 반응·밴드 변화·"시즌 종료 시 확정" 리마인드
  const [resultSheet, setResultSheet] = useState<{ p: Player; reaction: ReturnType<typeof resignReactionCopy> } | null>(null);

  return (
    <Screen title="계약 관리">
      <Card accent={theme.warn} flat>
        <Row>
          <IconLabel icon="card-outline" color={theme.warn}>팀 총연봉 / 캡</IconLabel>
          <Text style={{ color: total > LEAGUE_CAP ? theme.bad : theme.text, fontSize: 16, fontWeight: '800' }}>
            {formatMoney(total)} / {formatMoney(LEAGUE_CAP)}
          </Text>
        </Row>
        <Muted style={{ fontSize: 12 }}>
          잔여 {formatMoney(Math.max(0, LEAGUE_CAP - total))} · 선수 {roster.length}명 · 행을 누르면 재계약·방출
        </Muted>
      </Card>

      <Title>선수 계약</Title>
      {roster.map((p) => {
        const market = marketVal(p, getPlayerProduction(p.id, displayDay));
        const status = contractStatus(p.contract.salary, market);
        return (
          <Pressable key={p.id} onPress={() => setManage(p)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
            <PosTag pos={p.position} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.sub}>
                {p.age}세 · {formatMoney(p.contract.salary)} · 잔여 {p.contract.remaining}년 ·{' '}
                <Text style={{ color: STATUS_COLOR[status] }}>{status}</Text>
                {isFranchise(p) ? <Text style={{ color: theme.warn }}> · 프랜차이즈</Text> : null}
              </Text>
            </View>
            <OvrBadge value={overallRaw(p)} />
          </Pressable>
        );
      })}

      {foreigners.length > 0 ? (
        <>
          <Title>외국인 선수</Title>
          <Muted style={{ fontSize: 12 }}>
            외인·아시아쿼터는 1년 계약이라 방출·재계약 대상이 아닙니다. 재지명·교체는 외인 트라이아웃·시즌 중 교체에서 합니다.
          </Muted>
          {foreigners.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/player/${p.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
              <PosTag pos={p.position} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {p.name} <Text style={{ color: theme.accent }}>{p.isAsianQuota ? '아시아쿼터' : '외국인'}</Text>
                </Text>
                <Text style={styles.sub}>{p.age}세 · {formatMoney(p.contract.salary)} · 잔여 {p.contract.remaining}년</Text>
              </View>
              <OvrBadge value={overallRaw(p)} />
            </Pressable>
          ))}
        </>
      ) : null}

      {faList.length > 0 ? (
        <>
          <Title>FA 예정 (시즌 종료 시)</Title>
          <Muted style={{ fontSize: 12 }}>
            잔류는 "보낼지 말지"의 결정입니다. 시즌 종료 시 시장가로 재계약합니다(등급 프리미엄은 타 구단 영입가). 포기하면 떠납니다.
            {'\n'}단, 이번 시즌 저평가로 불만이 쌓인 선수는 시장가 재계약이어도 FA를 시험할 수 있습니다. 마음을 확실히 잡으려면 행을 눌러 '재계약'으로 후하게 미리 제안하세요.
            {'\n'}선수의 마음은 시즌 종료 시 확정됩니다. 불만이 크면 잡아도 뿌리칠 수 있습니다.
          </Muted>
          {faSorted.map(({ p, outlook }) => {
            const grade = faGrades.get(p.id)!;
            const reSalary = marketVal(p, getPlayerProduction(p.id, displayDay)); // 잔류 연봉 = 시장가(renewedContract, rollover.ts:49). ask(×프리미엄)는 타팀 영입가
            const bm = BAND_META[outlook.band];
            const keep = resignDecisions[p.id] !== false;
            return (
              <View key={p.id} style={styles.rowCol}>
                <View style={styles.info}>
                  <PosTag pos={p.position} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {p.name} <Text style={{ color: theme.accent }}>{grade}등급</Text>
                    </Text>
                    <Text style={styles.sub}>{p.age}세 · 잔류 연봉 {formatMoney(reSalary)} (시장가)</Text>
                  </View>
                  <OvrBadge value={overallRaw(p)} />
                </View>
                {/* 잔류 전망 밴드 + 사유 칩 — resignOutlookNow(엔진 위임). "시즌 종료 시 확정" 캡션은 상단 안내에. */}
                <View style={styles.outlookRow}>
                  <View style={[styles.bandTag, { borderColor: bm.color, backgroundColor: bm.color + '22' }]}>
                    <Text style={[styles.bandText, { color: bm.color }]}>잔류 {bm.label}</Text>
                  </View>
                  {outlook.chips.map((c) => (
                    <View key={c} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
                  ))}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setResign(p.id, true)}
                    style={[styles.btn, { borderColor: keep ? theme.good : theme.border, backgroundColor: keep ? theme.good + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.btnText, { color: keep ? theme.good : theme.muted }]}>잔류</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setResign(p.id, false)}
                    style={[styles.btn, { borderColor: !keep ? theme.bad : theme.border, backgroundColor: !keep ? theme.bad + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.btnText, { color: !keep ? theme.bad : theme.muted }]}>포기</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </>
      ) : null}

      {releasedPlayers.length > 0 ? (
        <>
          <Title>방출 선수</Title>
          {releasedPlayers.map((p) => (
            <View key={p.id} style={styles.rowCol}>
              <View style={styles.info}>
                <PosTag pos={p.position} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: theme.muted }]}>{p.name}</Text>
                  <Text style={styles.sub}>{p.age}세 · {formatMoney(p.contract.salary)}</Text>
                </View>
                <Pressable
                  onPress={() => { if (!unrelease(p.id)) showAlert('복귀 불가', '방출 철회는 방출 당일에만 가능합니다(이후엔 FA 시장에서 재영입).'); }}
                  style={[styles.btn, { borderColor: theme.good }]}
                >
                  <Text style={[styles.btnText, { color: theme.good }]}>복귀</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}

      <Muted style={{ fontSize: 12 }}>
        방출 선수는 즉시 FA가 되어 시즌 중 다른 팀이 영입할 수 있습니다(미영입 시 시즌말 정리).
        철회(복귀)는 방출 당일에만 가능합니다.
      </Muted>

      <ActionSheet
        visible={!!manage}
        title={manage?.name ?? ''}
        message={manage ? `${manage.age}세 · ${formatMoney(manage.contract.salary)} · 잔여 ${manage.contract.remaining}년` : undefined}
        onClose={() => setManage(null)}
        actions={manage ? [
          { label: '재계약', tone: 'primary', onPress: () => doResign(manage) },
          { label: '방출', tone: 'danger', onPress: () => doRelease(manage) },
          { label: '선수 정보', onPress: () => router.push(`/player/${manage.id}`) },
        ] : []}
      />

      {/* 재계약 오퍼 빌더(FA §2.5c-격상) — 연봉 배율·기간·주전보장 슬라이더. 원탭 기본값=표준(시장가·3년·보장off). 레버는 옵트인. */}
      <Popup visible={!!builder} onRequestClose={() => setBuilder(null)} dismissable>
        {builder ? (() => {
          const b = builder;
          const bounds = resignSalaryBounds(b.p, b.market);
          const maxYears = capContractYears(b.p.age + 1, 5);
          const mult = b.salary / Math.max(1, b.market);
          const draft: Contract = { salary: b.salary, years: b.years, remaining: b.years, signedAtAge: b.p.age, ...(b.guarantee ? { starterGuarantee: true } : {}) };
          // 라이브 잔류 전망 — 엔진 위임(단일 resignOutlookNow 호출, 레버 조합 실시간 반응). 대기 override 위에 이 오퍼를 얹어 평가.
          const outlook = resignOutlookNow(b.p, teamId, currentDay, interviews, season, { ...overrides, [b.p.id]: draft });
          // 캡션은 '기저 불만'(오퍼 무관 = 무엇으로 마음이 걸렸나)으로 판정 — 보장이 의미 있는지(minutes 불만)와 3분기.
          const baseTopic = resignOutlookNow(b.p, teamId, currentDay, interviews, season, overrides).topic;
          const cap = resignCaptionOf(baseTopic);
          const bm = BAND_META[outlook.band];
          const label = Math.abs(mult - 1) < 0.001 ? '표준' : mult > 1 ? `후하게 ×${mult.toFixed(2)}` : `짧게 ×${mult.toFixed(2)}`;
          const note = `${label} · ${formatMoney(b.salary)} · ${b.years}년${b.guarantee ? ' · 주전보장' : ''}`;
          const guarMeaningful = baseTopic === 'minutes';
          return (
            <>
              <Text style={styles.builderTitle}>{b.p.name} 재계약</Text>
              <Text style={styles.builderSub}>시장가 {formatMoney(b.market)} · {b.p.age}세{'\n'}{cap.text}</Text>

              <Stepper
                label="연봉"
                display={`${formatMoney(b.salary)}  (×${mult.toFixed(2)})`}
                decOff={b.salary <= bounds.min}
                incOff={b.salary >= bounds.max}
                onDec={() => setBuilder({ ...b, salary: Math.max(bounds.min, b.salary - bounds.step) })}
                onInc={() => setBuilder({ ...b, salary: Math.min(bounds.max, b.salary + bounds.step) })}
              />
              <Stepper
                label="기간"
                display={`${b.years}년`}
                decOff={b.years <= 1}
                incOff={b.years >= maxYears}
                onDec={() => setBuilder({ ...b, years: Math.max(1, b.years - 1) })}
                onInc={() => setBuilder({ ...b, years: Math.min(maxYears, b.years + 1) })}
              />
              {/* 정직성: 기간은 수락 확률에 무영향(resignOutlookNow는 years 미사용) — 캡 구속·다음 FA 시점만 바뀐다. */}
              <Muted style={styles.builderHint}>
                기간은 수락 확률에 영향이 없습니다. 캡 구속·다음 FA 시점의 트레이드오프입니다.{maxYears < 5 ? ` (나이 상 최대 ${maxYears}년)` : ''}
              </Muted>

              <Pressable
                onPress={() => setBuilder({ ...b, guarantee: !b.guarantee })}
                style={[styles.guarToggle, b.guarantee && { borderColor: theme.good, backgroundColor: theme.good + '18' }]}
              >
                <Text style={{ color: b.guarantee ? theme.good : theme.muted, fontWeight: '800', fontSize: 13 }}>
                  주전 보장 {b.guarantee ? 'ON' : 'OFF'}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 11, marginTop: 1, lineHeight: 15 }}>
                  {guarMeaningful
                    ? '출전 불만을 달래는 약속입니다. 지키지 못하고 벤치에 앉히면 배신(재계약 거부 급등)으로 돌아옵니다.'
                    : '이 선수에겐 의미 없는 약속입니다 (출전 불만 없음). 켜도 미래 파기 위험만 남습니다.'}
                </Text>
              </Pressable>

              {/* 라이브 잔류 전망 — 레버 조합에 실시간 반응(엔진 위임) */}
              <View style={styles.builderOutlook}>
                <View style={[styles.bandTag, { borderColor: bm.color, backgroundColor: bm.color + '22' }]}>
                  <Text style={[styles.bandText, { color: bm.color }]}>잔류 {bm.label}</Text>
                </View>
                {outlook.chips.map((c) => (
                  <View key={c} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
                ))}
              </View>

              <Pressable
                onPress={() => pickOffer(b.p, draft, outlook.band, label, note)}
                style={[styles.applyBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]}
              >
                <Text style={{ color: theme.accent, fontWeight: '800', fontSize: 15 }}>이 오퍼로 제안</Text>
              </Pressable>
              <Pressable onPress={() => setBuilder(null)} style={styles.builderCancel}>
                <Text style={styles.builderCancelTxt}>취소</Text>
              </Pressable>
            </>
          );
        })() : null}
      </Popup>

      {/* 재계약 제안 — 오퍼일 뿐, 확정(선수 수락)은 시즌 종료 시(FA §2.5c-보완 봉인). store reSign 실패 시 사유 모달(UI-21) */}
      <ActionSheet
        visible={!!confirmSheet}
        title="재계약 제안"
        message={confirmSheet ? `${confirmSheet.p.name}, ${confirmSheet.label}\n연봉 ${formatMoney(confirmSheet.p.contract.salary)} → ${formatMoney(confirmSheet.contract.salary)} · ${confirmSheet.contract.years}년${confirmSheet.contract.starterGuarantee ? ' · 주전보장' : ''}\n잔류 전망: ${BAND_META[confirmSheet.band].label}\n\n※ 제안일 뿐입니다. 불만이 큰 선수는 시즌 종료 시 뿌리치고 FA로 나갈 수 있습니다.` : undefined}
        onClose={() => setConfirmSheet(null)}
        actions={confirmSheet ? [
          {
            label: '제안', tone: 'primary',
            onPress: () => {
              const cs = confirmSheet;
              // 제안 전/후 잔류 전망 — 결과 피드백(step3). money 불만 해소면 밴드가 실제로 변한다.
              const before = resignOutlookNow(cs.p, teamId, currentDay, interviews, season, overrides);
              const after = resignOutlookNow(cs.p, teamId, currentDay, interviews, season, { ...overrides, [cs.p.id]: cs.contract });
              const res = reSign(cs.p.id, cs.contract);
              if (!res.ok) { showAlert('재계약 불가', resignRejectMessage(cs.p, res.reason)); return; }
              setResultSheet({ p: cs.p, reaction: resignReactionCopy(before.band, after.band) });
            },
          },
        ] : []}
      />

      {/* 제안 직후 결과 피드백(step3) — 선수 반응 + 밴드 변화 + "시즌 종료 시 확정" 리마인드 + FA 비대칭 프레이밍 */}
      <ActionSheet
        visible={!!resultSheet}
        title={resultSheet ? `${resultSheet.p.name}, 제안 전달` : ''}
        message={resultSheet ? `${resultSheet.reaction.line}\n\n${resultSheet.reaction.remind}\n${resultSheet.reaction.framing}` : undefined}
        onClose={() => setResultSheet(null)}
        actions={resultSheet ? [{ label: '확인', tone: 'primary', onPress: () => {} }] : []}
      />
    </Screen>
  );
}

/** −/＋ 스텝퍼(연봉·기간) — FA 오퍼 폼과 같은 결. */
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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: theme.border,
  },
  rowCol: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.border },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.muted, fontSize: 13, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '800' },
  outlookRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  bandTag: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bandText: { fontSize: 12, fontWeight: '800' },
  chip: { backgroundColor: theme.border + '55', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  chipText: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  // ── 재계약 오퍼 빌더(FA §2.5c-격상) ──
  builderTitle: { color: theme.text, fontSize: 19, fontWeight: '900' },
  builderSub: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: -4 },
  builderHint: { fontSize: 11, lineHeight: 15, marginTop: -4 },
  builderOutlook: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  guarToggle: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  applyBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 2 },
  builderCancel: { paddingVertical: 11, alignItems: 'center' },
  builderCancelTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepLabel: { color: theme.text, fontSize: 13, fontWeight: '700', width: 44 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: theme.accent,
    backgroundColor: theme.accent + '18', alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { borderColor: theme.border, backgroundColor: 'transparent' },
  stepBtnTxt: { color: theme.text, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  stepVal: { color: theme.text, fontSize: 14, fontWeight: '800', flex: 1, textAlign: 'center' },
}));

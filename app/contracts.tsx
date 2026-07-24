// 계약 관리 전용 화면 — 단장실 "계약 관리"에서 진입.
// 1행 = 선수 1명. 행을 누르면 재계약/방출 선택(액션시트). FA 예정·방출 선수도 여기서 처리.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import { confirmDraftPickReset } from '../components/draftPickGuard';
import { Button, Loading, Muted, OvrBadge, PosTag, Screen, SCREEN_LOADING_MIN_MS, Title, theme, themedStyles, useDeferredReady } from '../components/Screen';
import { PlayerRow } from '../components/PlayerRow';
import { SummaryCard } from '../components/SummaryCard';
import { ActionSheet, Popup } from '../components/Popup';
import { Stepper } from '../components/Stepper';
import { getPlayer, evolveOnDay, LEAGUE } from '../data/league';
import { fmtMatches } from '../data/recordLine';
import { rosterIdsOnDay, activeRosterOnDay } from '../data/dynamics';
import { teamRelations } from '../data/relationships';
import { getPlayerProduction } from '../data/production';
import { displayCutoff } from '../data/standings';
import { capPayroll } from '../data/roster';
import { overallRaw } from '../engine/overall';
import { isFranchise, maxSalaryFor, LEAGUE_CAP } from '../engine/cap';
import { severanceFee, inSeasonCost } from '../engine/transactions';
import { assignFAGrades, willBeFA } from '../engine/faMarket';
import { contractStatus, formatMoney, resignSalaryBounds } from '../engine/salary';
import { capContractYears } from '../engine/retire';
import { marketVal, renewalVal } from '../data/awardSalary';
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

  // 날짜 인지 명단(UI-43a) — 시즌 중 FA 영입 선수 포함·방출 제외(rosterIdsOnDay가 txLog로 처리). base 직독은 시즌 중 영입을 놓쳤다.
  const active = activeRosterOnDay(teamId, currentDay, overrides);
  // store 캡 게이트와 동일한 재료(capPayroll §7): 배신 판정·시즌 중 영입 집합. 표시 연봉도 이 집합으로 inSeasonCost 산입(UI-43b).
  const isBetrayed = (id: string) => inSeasonTx.some((t) => t.kind === 'release' && t.teamId === teamId && t.playerId === id);
  const inSeasonSigned = new Set(inSeasonTx.filter((t) => t.kind === 'sign' && t.teamId === teamId).map((t) => t.playerId));
  // 표시 연봉 = 캡 산입액(UI-43b): 시즌 중 영입 선수는 취득가 inSeasonCost(marketVal, betrayed), 그 외는 (override 반영) 계약 연봉.
  const salaryOf = (p: Player) => (inSeasonSigned.has(p.id) ? inSeasonCost(marketVal(p), isBetrayed(p.id)) : p.contract.salary);
  // 계약 관리는 국내 전용 — 외인/아시아쿼터는 1년 트라이아웃 계약이라 방출·재계약·FA 비대상(FOREIGN_SYSTEM 3장).
  const roster = active.filter((p) => !p.isForeign).sort((a, b) => salaryOf(b) - salaryOf(a));
  const foreigners = active.filter((p) => p.isForeign).sort((a, b) => overallRaw(b) - overallRaw(a));
  // 수입 슬롯 공석 판정(FOREIGN_SYSTEM §2 — 자금 부족 시 미영입 = 공석으로 시즌 시작). 팀은 외인 OP 1 + 아시아쿼터 1이 정상.
  const hasForeignOP = foreigners.some((p) => !p.isAsianQuota);
  const hasAsian = foreigners.some((p) => p.isAsianQuota);
  // 헤더 총연봉 = store 게이트와 동일 산식(UI-43b, capPayroll §7): 그날 유효 명단(rosterIdsOnDay — 시즌 중 영입 포함·방출 제외)에
  // 재계약 override·시즌 영입비(inSeasonCost)·배신 웃돈 반영. 국내만(capPayroll 내부에서 외인 제외). pickOffer 사전체크와 재료 공유.
  const myIds = rosterIdsOnDay(teamId, currentDay);
  const capPlayers = myIds.map((id) => evolveOnDay(id, currentDay)).filter((p): p is Player => !!p);
  const total = capPayroll(capPlayers, overrides, inSeasonSigned, isBetrayed);
  const releasedPlayers = released.map((id) => getPlayer(id)).filter((p): p is Player => !!p);
  const faList = roster.filter(willBeFA);
  // FA 등급은 **리그 전체 FA 예정 풀** 순위로 매긴다(assignFAGrades는 상대 순위 — 내 팀 부분집합으로 매기면
  //   1명일 때 무조건 A로 오표시). 오프시즌 풀 근사: 전 구단 현재 명단에서 willBeFA 국내 선수 수집(EC-FA-09 형제).
  //   풀도 날짜 인지 명단(UI-43a)으로 — faList(위 active 파생)와 같은 소스여야 내 시즌 중 영입 FA 예정자가
  //   풀에서 빠져 faGrades.get(...)!가 undefined("undefined등급")가 되는 어긋남이 없다(2026-07-15 형제 발견).
  const leagueFaGrades = useMemo(() => {
    const pool: Player[] = [];
    for (const t of LEAGUE.teams) {
      for (const p of activeRosterOnDay(t.id, currentDay, overrides)) {
        if (!p.isForeign && willBeFA(p)) pool.push(p);
      }
    }
    return assignFAGrades(pool);
  }, [currentDay, overrides, inSeasonTx]);
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
    //   재료(capPlayers·inSeasonSigned·isBetrayed)는 헤더 총연봉과 공유(§7 6번째 사이트 = store reSign 게이트와 동일 경로).
    if (!isFranchise(p)) {
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
    // 위약금·절감 연봉은 store release와 동일하게 **base 계약**(getPlayer.contract) 기준(UI-43b/UV-2) — 화면이 override(대기 재계약)
    //   계약을 얹어 보여줘도 store useGameStore.release는 getPlayer(id).contract로 차감한다. 표시≠차감(재화 split-brain의 UI판)을 막는다.
    const bc = getPlayer(p.id)?.contract;
    const fee = bc ? severanceFee(bc.salary, bc.remaining) : 0;
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
      c.matches > 0 ? `${fmtMatches(c.matches)}경기 · ${stat}` : '아직 기록 없음',
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
      `${retro}${friendWarn}\n\n위약금 ${formatMoney(fee)} 지불 · 연봉 ${formatMoney(bc?.salary ?? 0)} 절감\n(당일 철회 가능)${tone}`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '방출', style: 'destructive',
          // 실제 store 거부 사유와 일치하는 안내(발견 모드 감사 2026-07-15) — 구 문구 "로스터 하한(10명)"은
          // 폐기된 총원 게이트라 오도. 현행 게이트 = 포지션 최소 인원(floor)·위약금·플옵 엔트리 동결.
          onPress: () => { if (!release(p.id)) showAlert('방출 불가', `방출할 수 없습니다.\n가능한 사유 — 그 포지션 최소 인원 미달(포지션마다 최소 보유 수 유지) · 위약금(${formatMoney(fee)}) 부족 · 포스트시즌 기간(명단 동결)`); },
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

  // 요약 카드 인원 라벨은 "국내 N명"(BUG-03, 2026-07-24) — 이 화면의 계약 목록은 국내 전용(:84 !isForeign 필터)이라
  //   단장실의 "선수 N명"(전체=국내+수입)과 수가 다르다. 같은 문구면 같은 수를 기대하게 되므로 무엇을 세는지 드러낸다.
  //   같은 화면 아래에 "수입 선수" 카드가 따로 있어(수입 2명) 총원은 국내+수입으로 읽힌다.
  return (
    <Screen title="계약 관리">
      <SummaryCard
        icon="card-outline"
        color={theme.warn}
        label="팀 총연봉 / 캡"
        value={`${formatMoney(total)} / ${formatMoney(LEAGUE_CAP)}`}
        valueStyle={{ color: total > LEAGUE_CAP ? theme.bad : theme.text, fontSize: 16, fontWeight: '800' }}
        caption={`잔여 ${formatMoney(Math.max(0, LEAGUE_CAP - total))} · 국내 ${roster.length}명 · 행을 누르면 재계약·방출`}
      />

      {/* 아래 "수입 선수" 섹션과 짝 — 이 목록이 국내 전용임을 제목에서 드러낸다(BUG-03) */}
      <Title>국내 선수 계약</Title>
      {roster.map((p) => {
        const market = marketVal(p, getPlayerProduction(p.id, displayDay));
        const status = contractStatus(salaryOf(p), market);
        const signed = inSeasonSigned.has(p.id);
        return (
          <PlayerRow
            key={p.id}
            onPress={() => setManage(p)}
            leading={<PosTag pos={p.position} />}
            title={p.name}
            sub={
              <>
                {p.age}세 · {formatMoney(salaryOf(p))} · 잔여 {p.contract.remaining}년 ·{' '}
                <Text style={{ color: STATUS_COLOR[status] }}>{status}</Text>
                {signed ? <Text style={{ color: theme.sky }}> · 시즌 중 영입</Text> : null}
                {isFranchise(p) ? <Text style={{ color: theme.warn }}> · 프랜차이즈</Text> : null}
              </>
            }
            trailing={<OvrBadge value={overallRaw(p)} />}
          />
        );
      })}

      <Title>수입 선수 (외국인·아시아쿼터)</Title>
      <Muted style={{ fontSize: 12 }}>
        외인·아시아쿼터는 1년 계약이라 방출·재계약 대상이 아닙니다. 재지명·교체는 외인 트라이아웃·시즌 중 교체에서 합니다.
      </Muted>
      {foreigners.map((p) => (
        <PlayerRow
          key={p.id}
          onPress={() => router.push(`/player/${p.id}`)}
          leading={<PosTag pos={p.position} />}
          title={<>{p.name} <Text style={{ color: theme.accent }}>{p.isAsianQuota ? '아시아쿼터' : '외국인'}</Text></>}
          sub={`${p.age}세 · ${formatMoney(p.contract.salary)} · 잔여 ${p.contract.remaining}년`}
          trailing={<OvrBadge value={overallRaw(p)} />}
        />
      ))}
      {!hasForeignOP ? (
        <View style={styles.vacancy}>
          <Text style={styles.vacancyTitle}>외국인 OP 공석</Text>
          <Muted style={{ fontSize: 12 }}>운영 자금 부족 등으로 미영입 상태입니다. 다음 오프시즌 외국인 트라이아웃에서 영입하세요.</Muted>
        </View>
      ) : null}
      {!hasAsian ? (
        <View style={styles.vacancy}>
          <Text style={styles.vacancyTitle}>아시아쿼터 공석</Text>
          <Muted style={{ fontSize: 12 }}>운영 자금 부족 등으로 미영입 상태입니다. 다음 오프시즌 아시아쿼터 FA에서 영입하세요.</Muted>
        </View>
      ) : null}

      {faList.length > 0 ? (
        <>
          <Title>FA 예정 (시즌 종료 시)</Title>
          <Pressable
            onPress={() => showAlert(
              'FA 예정 — 잔류 · 재계약',
              '잔류\n시즌 종료 시 그 선수를 시장가로 재계약하는 예약입니다. 등급 프리미엄(타 구단 영입가)은 잔류 연봉에 붙지 않습니다.'
              + '\n\n포기\n시즌 종료 시 팀에서 내보냅니다.'
              + '\n\n잔류해도 떠날 수 있어요\n이번 시즌 저평가로 불만이 쌓인 선수는 시장가 재계약을 뿌리치고 FA를 시험할 수 있습니다.'
              + "\n\n확실히 잡으려면 — 재계약\n카드의 '재계약으로 미리 잡기'(또는 위 '선수 계약'에서 그 선수)를 눌러 시장가보다 후하게 미리 제안하세요."
              + '\n\n잔류 전망(안정 · 유동 · 위험)\n시즌 종료 시 시장가 재계약을 거절할 확률입니다. 선수의 마음은 시즌 종료 시 확정됩니다.',
            )}
          >
            <Muted style={{ fontSize: 12, lineHeight: 17 }}>
              <Text style={{ color: theme.good, fontWeight: '800' }}>잔류</Text> = 시즌 종료 시 시장가로 재계약 예약 · <Text style={{ color: theme.bad, fontWeight: '800' }}>포기</Text> = 내보냄.
              {'\n'}불만 큰 선수는 잔류해도 떠날 수 있어요 → <Text style={{ color: theme.accent, fontWeight: '800' }}>재계약</Text>으로 미리 후하게 잡기.
              {' '}<Text style={{ color: theme.sky, fontWeight: '800' }}>자세히 ›</Text>
            </Muted>
          </Pressable>
          {faSorted.map(({ p, outlook }) => {
            const grade = faGrades.get(p.id)!;
            // 잔류 연봉 = 실제 잔류 확정 산식 미러(renewalVal = renewedContract salary: 현재 시대 앵커·prod/award 미포함, UI-43b/UV-3).
            //   marketVal(prod·수상 프리미엄 포함)로 표시하면 MVP급이 체계적 과대 표시됐다. 나이+1·미래 진화 오차는 "(예상)" 캡션으로 수용.
            //   ask(등급 ×프리미엄)는 타 구단 영입가로 별개.
            const reSalary = renewalVal(p);
            const bm = BAND_META[outlook.band];
            const keep = resignDecisions[p.id] !== false;
            return (
              <View key={p.id} style={styles.rowCol}>
                <PlayerRow
                  bare
                  leading={<PosTag pos={p.position} />}
                  title={<>{p.name} <Text style={{ color: theme.accent }}>{grade}등급</Text></>}
                  sub={`${p.age}세 · 잔류 연봉 ${formatMoney(reSalary)} (예상)`}
                  trailing={<OvrBadge value={overallRaw(p)} />}
                />
                {/* 잔류 전망 밴드 + 사유 칩 — resignOutlookNow(엔진 위임). "시즌 종료 시 확정" 캡션은 상단 안내에. */}
                <View style={styles.outlookRow}>
                  <View style={[styles.bandTag, { borderColor: bm.color, backgroundColor: bm.color + '22' }]}>
                    <Text style={[styles.bandText, { color: bm.color }]}>잔류 {bm.label}</Text>
                  </View>
                  {outlook.chips.map((c) => (
                    <View key={c} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
                  ))}
                </View>
                {/* 잔류 위험 = 시장가 재계약 거부 확률 높음. 잔류(예약)와 재계약(선제 후한 제안)의 차이를 카드에서 바로
                    이해시키는 유도 — 탭하면 기존 재계약 오퍼 빌더(doResign)로 바로. 표시/진입점 연결일 뿐 엔진 불변. */}
                {outlook.band === 'risk' ? (
                  <Pressable onPress={() => doResign(p)} style={styles.resignNudge}>
                    <Text style={styles.resignNudgeWarn}>이대로면 시즌 종료 시 떠날 수 있어요.</Text>
                    <Text style={styles.resignNudgeCta}>재계약으로 미리 잡기 →</Text>
                  </Pressable>
                ) : null}
                <View style={styles.actions}>
                  <Button small fill tone="good" off={!keep} label="잔류" onPress={() => confirmDraftPickReset(() => setResign(p.id, true))} />
                  <Button small fill tone="bad" off={keep} label="포기" onPress={() => confirmDraftPickReset(() => setResign(p.id, false))} />
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
              <PlayerRow
                bare
                leading={<PosTag pos={p.position} />}
                title={p.name}
                titleStyle={{ color: theme.muted }}
                sub={`${p.age}세 · ${formatMoney(p.contract.salary)}`}
                trailing={
                  <Button
                    small
                    fill
                    outline
                    tone="good"
                    label="복귀"
                    onPress={() => { if (!unrelease(p.id)) showAlert('복귀 불가', '방출 철회는 방출 당일에만 가능합니다(이후엔 FA 시장에서 재영입).'); }}
                  />
                }
              />
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
        message={manage ? `${manage.age}세 · ${formatMoney(salaryOf(manage))} · 잔여 ${manage.contract.remaining}년` : undefined}
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
            // 재계약(contractOverrides)도 드래프트 확정 픽을 무효화한다 — 허브에선 "드래프트 후 계약 관리"가 상시 가능(§5.6.3 ④a).
            onPress: () => confirmDraftPickReset(() => {
              const cs = confirmSheet;
              // 제안 전/후 잔류 전망 — 결과 피드백(step3). money 불만 해소면 밴드가 실제로 변한다.
              const before = resignOutlookNow(cs.p, teamId, currentDay, interviews, season, overrides);
              const after = resignOutlookNow(cs.p, teamId, currentDay, interviews, season, { ...overrides, [cs.p.id]: cs.contract });
              const res = reSign(cs.p.id, cs.contract);
              if (!res.ok) { showAlert('재계약 불가', resignRejectMessage(cs.p, res.reason)); return; }
              setResultSheet({ p: cs.p, reaction: resignReactionCopy(before.band, after.band) });
            }),
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

const styles = themedStyles(() => StyleSheet.create({
  rowCol: { backgroundColor: theme.card, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: theme.border },
  actions: { flexDirection: 'row', gap: 8 },
  outlookRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  bandTag: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  bandText: { fontSize: 12, fontWeight: '800' },
  chip: { backgroundColor: theme.border + '55', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  chipText: { color: theme.muted, fontSize: 11, fontWeight: '700' },
  // 잔류 위험 유도 카드(경고 + 재계약 진입) — 표시 전용, doResign(기존 오퍼 빌더)로 연결.
  resignNudge: { borderWidth: 1, borderColor: theme.bad + '55', backgroundColor: theme.bad + '14', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  resignNudgeWarn: { color: theme.bad, fontSize: 12, fontWeight: '700' },
  resignNudgeCta: { color: theme.accent, fontSize: 13, fontWeight: '800' },
  // 수입 슬롯 공석 배너(FOREIGN_SYSTEM §2 — 자금 부족 미영입) — 비클릭 정보(flat: 얇은 보더 + 옅은 warn tint, 그림자 없음).
  vacancy: { borderWidth: 1, borderColor: theme.warn + '55', backgroundColor: theme.warn + '14', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 2, marginTop: 6 },
  vacancyTitle: { color: theme.warn, fontSize: 13, fontWeight: '800' },
  // ── 재계약 오퍼 빌더(FA §2.5c-격상) ──
  builderTitle: { color: theme.text, fontSize: 19, fontWeight: '900' },
  builderSub: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: -4 },
  builderHint: { fontSize: 11, lineHeight: 15, marginTop: -4 },
  builderOutlook: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  guarToggle: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  applyBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 2 },
  builderCancel: { paddingVertical: 11, alignItems: 'center' },
  builderCancelTxt: { color: theme.muted, fontSize: 14, fontWeight: '700' },
}));

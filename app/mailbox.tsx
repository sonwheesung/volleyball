// 우편함 화면 (MAILBOX_SYSTEM §6.1) — 운영 보상·개별 지급(CS)·이벤트 + 다이아 패스 일일 우편의 수령처.
// 상태 3탭(기본 안받음 / 받음 / 전체) 서버 재조회 · 받기/모두 받기(부분 실패 집계 토스트 1회) · 만료 표시 · 오프라인 캐시.
// 재화는 서버 진실(§2) — 수령 성공 응답 후 syncWallet로만 잔액·카운트 수렴(낙관 금지). 화면 진입 시 read로 빨간 점 소등(§6.3).
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Muted, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';
import { emitGlobalToast } from '../lib/toastBus';
import { listMail, claimMail, readMail, type MailItem, type MailStatus } from '../lib/server';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// 탭 전환·재진입 사이 마지막 성공 목록 캐시(오프라인 표시용, §6.1) — 모듈 스코프(스크린 언마운트에도 유지).
const MAIL_CACHE: Partial<Record<MailStatus, MailItem[]>> = {};

// 표시 순서 = 전체 / 안받음 / 받음(사용자 피드백 2026-07-23, MAILBOX §6.1). 기본 선택 탭은 여전히 '안받음'(useState 초기값) — 순서만 변경.
const TABS: Array<{ key: MailStatus; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'unclaimed', label: '안받음' }, // 기본 선택 — 열자마자 수령할 우편(사용자 정정 2026-07-23 확정)
  { key: 'claimed', label: '받음' },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
/** 만료까지 D-N / 만료됨 — DB now 기준이 진실이나 표시는 클라 시각으로 근사(수령 판정은 서버). */
function expiryLabel(iso: string): { expired: boolean; label: string } {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return { expired: true, label: '만료됨' };
  return { expired: false, label: `D-${days}` };
}
function attachBadge(m: MailItem): string {
  if (m.attachType === 'pass') return '🎫 다이아 패스';
  return `💎 ${(m.attachAmount ?? 0).toLocaleString()}`;
}

export default function Mailbox() {
  const [tab, setTab] = useState<MailStatus>('unclaimed');
  const [items, setItems] = useState<MailItem[]>(() => MAIL_CACHE['unclaimed'] ?? []);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const setMailCounts = useGameStore((s) => s.setMailCounts);
  const syncWallet = useGameStore((s) => s.syncWallet);

  const fetchList = useCallback(async (status: MailStatus) => {
    setLoading(true);
    const r = await listMail(status);
    if (r.ok) {
      MAIL_CACHE[status] = r.items;
      setItems(r.items);
      setOffline(false);
    } else if (r.reason === 'offline') {
      setItems(MAIL_CACHE[status] ?? []); // 오프라인 → 마지막 캐시 표시(§6.1)
      setOffline(true);
    } else {
      setItems([]);
      setOffline(false);
    }
    setLoading(false);
  }, []);

  // 진입 1회 — 목록 로드 + read(빨간 점 소등, §6.3). read 응답 카운트를 캐시에 반영(폴링 아님).
  useEffect(() => {
    void fetchList('unclaimed');
    (async () => {
      const r = await readMail();
      if (r.ok) setMailCounts(r.unreadMailCount, r.unclaimedMailCount);
    })();
  }, [fetchList, setMailCounts]);

  const switchTab = (next: MailStatus) => {
    if (next === tab) return;
    setTab(next);
    setExpandedId(null);
    setItems(MAIL_CACHE[next] ?? []); // 캐시 즉시 표시 후 서버 재조회로 덮음(체감 지연 완화)
    void fetchList(next);
  };

  const claimOne = async (m: MailItem) => {
    if (claimingId || claimingAll || offline) return;
    setClaimingId(m.id);
    const r = await claimMail(m.id, m.kind);
    if (r.ok) {
      if (r.applied) emitGlobalToast(r.attachType === 'pass' ? '다이아 패스를 받았습니다' : `+${(m.attachAmount ?? 0).toLocaleString()}💎 받았습니다`);
      else emitGlobalToast('이미 받은 우편이에요');
    } else if (r.reason === 'pass-queue-full') {
      emitGlobalToast('패스 예약이 가득해 지금은 받을 수 없어요');
    } else if (r.reason === 'expired') {
      emitGlobalToast('만료된 우편이에요');
    } else if (r.reason === 'offline') {
      emitGlobalToast('연결이 필요합니다');
    } else if (r.reason !== 'not-found') {
      emitGlobalToast('잠시 후 다시 시도해 주세요');
    }
    await syncWallet();       // 서버 확정 잔액·카운트 수렴(낙관 금지)
    await fetchList(tab);
    setClaimingId(null);
  };

  const claimAll = async () => {
    if (claimingAll || claimingId || offline) return;
    const targets = items.filter((m) => !m.claimedAt && !expiryLabel(m.expiresAt).expired);
    if (!targets.length) return;
    setClaimingAll(true);
    let claimed = 0, held = 0, failed = 0;
    for (const m of targets) {
      const r = await claimMail(m.id, m.kind);
      if (r.ok && r.applied) claimed++;
      else if (!r.ok && r.reason === 'pass-queue-full') held++;
      else if (!r.ok && r.reason !== 'not-found') failed++;
      // applied:false(이미 수령)·not-found는 집계 제외(무해)
    }
    await syncWallet();
    await fetchList(tab);
    setClaimingAll(false);
    // 부분 실패 = 집계 토스트 1회(§6.1 S7) — 건별 난사 금지
    const parts: string[] = [];
    if (claimed > 0) parts.push(`${claimed}건 수령`);
    if (held > 0) parts.push(`${held}건은 패스 예약이 가득해 보류`);
    if (parts.length) emitGlobalToast(parts.join(' · '));
    else if (failed > 0) emitGlobalToast('일부 우편을 받지 못했어요. 잠시 후 다시 시도해 주세요');
    else emitGlobalToast('받을 우편이 없어요');
  };

  const claimableCount = items.filter((m) => !m.claimedAt && !expiryLabel(m.expiresAt).expired).length;

  return (
    <Screen>
      {/* 상태 필터 3탭 — 전환 시 서버 재조회(§6.1) */}
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => switchTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {offline ? (
        <View style={styles.offlineNote}>
          <Ionicons name={'cloud-offline-outline' as IoniconName} size={15} color={theme.muted} />
          <Text style={styles.offlineTxt}>오프라인 — 마지막에 본 우편만 표시돼요. 받으려면 연결이 필요합니다.</Text>
        </View>
      ) : null}

      {/* 모두 받기 — 미수령·미만료가 있고 온라인일 때 */}
      {claimableCount > 0 && !offline ? (
        <Pressable onPress={claimAll} disabled={claimingAll || !!claimingId} style={[styles.claimAllBtn, (claimingAll || !!claimingId) && styles.btnOff]}>
          <Text style={styles.claimAllTxt}>{claimingAll ? '받는 중…' : `모두 받기 (${claimableCount}건)`}</Text>
        </Pressable>
      ) : null}

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={theme.accent} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name={'mail-open-outline' as IoniconName} size={40} color={theme.muted} />
          <Muted style={styles.emptyTxt}>
            {/* 문장(마침표) 경계 명시 줄바꿈 — 폭에 따른 문장 중간 꺾임 방지(사용자 피드백 2026-07-23, MAILBOX §6.1) */}
            {tab === 'unclaimed' ? '받을 우편이 없어요.\n전체 탭에서 지난 우편을 확인해 보세요.' : '우편이 없어요'}
          </Muted>
        </View>
      ) : (
        items.map((m) => {
          const exp = expiryLabel(m.expiresAt);
          const claimed = !!m.claimedAt;
          const canClaim = !claimed && !exp.expired && !offline;
          const expanded = expandedId === m.id;
          return (
            <Pressable key={`${m.kind}:${m.id}`} onPress={() => setExpandedId(expanded ? null : m.id)}
              style={[styles.row, claimed && styles.rowDim, exp.expired && !claimed && styles.rowExpired]}>
              <View style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, claimed && styles.dimText]} numberOfLines={expanded ? undefined : 1}>{m.title}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.attach, claimed && styles.dimText]}>{attachBadge(m)}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.meta}>{fmtDate(m.createdAt)}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={[styles.meta, exp.expired && styles.expiredText]}>
                      {claimed ? '수령됨' : exp.expired ? '만료됨' : exp.label}
                    </Text>
                  </View>
                </View>
                {!claimed && !exp.expired ? <View style={styles.newDot} /> : null}
                <Text style={styles.chevron}>{expanded ? '⌄' : '›'}</Text>
              </View>
              {expanded ? (
                <View style={styles.body}>
                  <Text style={styles.bodyTxt}>{m.body}</Text>
                  {canClaim ? (
                    <Pressable onPress={() => claimOne(m)} disabled={!!claimingId || claimingAll}
                      style={[styles.claimBtn, (!!claimingId || claimingAll) && styles.btnOff]}>
                      <Text style={styles.claimTxt}>{claimingId === m.id ? '받는 중…' : '받기'}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.claimNote}>
                      {claimed ? '이미 받은 우편이에요' : exp.expired ? '만료돼 받을 수 없어요' : '받으려면 연결이 필요합니다'}
                    </Text>
                  )}
                </View>
              ) : null}
            </Pressable>
          );
        })
      )}

      <Muted style={styles.footer}>{'운영 보상·이벤트·다이아 패스 우편이 여기로 도착해요.\n우편은 도착 후 30일간 보관됩니다.'}</Muted>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: theme.cardAlt, alignItems: 'center' },
  tabActive: { backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent },
  tabTxt: { color: theme.muted, fontSize: 13.5, fontWeight: '800' },
  tabTxtActive: { color: theme.accent },
  offlineNote: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.cardAlt, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 12 },
  offlineTxt: { flex: 1, color: theme.muted, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  claimAllBtn: { backgroundColor: theme.accent, borderRadius: 11, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  claimAllTxt: { color: '#08131F', fontSize: 14.5, fontWeight: '900' },
  btnOff: { opacity: 0.5 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyTxt: { fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 },
  row: { backgroundColor: theme.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: theme.accent },
  rowDim: { borderLeftColor: theme.border, opacity: 0.72 },
  rowExpired: { borderLeftColor: theme.muted, opacity: 0.6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { color: theme.text, fontSize: 15, fontWeight: '800' },
  dimText: { color: theme.muted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  attach: { color: theme.gold, fontSize: 12.5, fontWeight: '800' },
  meta: { color: theme.muted, fontSize: 12, fontWeight: '700' },
  metaDot: { color: theme.muted, fontSize: 12 },
  expiredText: { color: theme.muted },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.bad },
  chevron: { color: theme.muted, fontSize: 22, fontWeight: '400' },
  body: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border, gap: 12 },
  bodyTxt: { color: theme.text, fontSize: 13.5, lineHeight: 21 },
  claimBtn: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  claimTxt: { color: '#08131F', fontSize: 14, fontWeight: '900' },
  claimNote: { color: theme.muted, fontSize: 12.5, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  footer: { fontSize: 12, marginTop: 14, textAlign: 'center', lineHeight: 18 },
}));

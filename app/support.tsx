// 문의하기 (BACKEND_SYSTEM §8·§13.6, #45 표면) — 마이페이지 진입. 목록(빈 상태) + 우상단 [문의] → 등록.
// 카테고리(오류/건의/질문/기타) + 내용. 제출 시 진단 스냅샷(최근 10시즌 재계산)을 **비동기로** 첨부.
// 서버는 lib/server.ts(throw 없음) — 오프라인이면 조용히 안내(온라인 연결 후 재시도). 관전/게임엔 영향 0.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore } from '../store/useGameStore';
import { ENGINE_VERSION } from '../engine/match';
import { buildDiagnosticSnapshot } from '../data/diagnosticSnapshot';
import { getSnapshotLogs } from '../lib/deviceLog';
import {
  createTicket, listTickets, uploadSnapshot,
  type TicketCategory,
} from '../lib/server';
import { getDeviceInfo } from '../lib/device';

const CATS: { key: TicketCategory; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'bug', label: '오류', icon: 'bug-outline' },
  { key: 'suggestion', label: '건의', icon: 'bulb-outline' },
  { key: 'question', label: '질문', icon: 'help-circle-outline' },
  { key: 'refund', label: '환불', icon: 'card-outline' },
  { key: 'etc', label: '기타', icon: 'ellipsis-horizontal-outline' },
];
const CAT_KO: Record<TicketCategory, string> = { bug: '오류', suggestion: '건의', question: '질문', refund: '환불 신청', etc: '기타' };
const STATUS_KO: Record<string, string> = { open: '답변 대기', replied: '답변 완료', resolved: '처리 완료', refunded: '환불 완료' };

type Ticket = { id: string; category: TicketCategory; content: string; status?: string; reply?: string; createdAt: string };

export default function Support() {
  const [mode, setMode] = useState<'list' | 'compose'>('list');
  const [tickets, setTickets] = useState<Ticket[] | null>(null); // null=로딩, []=빈, [...]=목록
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    setTickets(null);
    const r = await listTickets();
    if (r.ok) { setTickets(r.tickets); setOffline(false); }
    else { setTickets([]); setOffline(r.reason === 'offline'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (mode === 'compose') return <Compose onDone={() => { setMode('list'); void load(); }} />;

  return (
    <Screen title="문의하기">
      <View style={styles.topBar}>
        <Pressable onPress={() => setMode('compose')} hitSlop={10} style={styles.topBtn}>
          <Ionicons name="create-outline" size={16} color={theme.accent} />
          <Text style={styles.newBtn}>문의</Text>
        </Pressable>
      </View>
      {tickets === null ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
      ) : tickets.length === 0 ? (
        <View style={{ paddingTop: 60, alignItems: 'center', gap: 8 }}>
          <Ionicons name="chatbubbles-outline" size={40} color={theme.muted} />
          <Muted style={{ fontSize: 14 }}>{offline ? '오프라인 — 온라인 연결 후 문의 내역이 표시됩니다' : '문의 내역이 없습니다'}</Muted>
          <Pressable onPress={() => setMode('compose')} style={styles.emptyBtn}><Text style={styles.emptyBtnTxt}>문의하기</Text></Pressable>
        </View>
      ) : (
        tickets.map((t) => (
          <Card key={t.id} accent={t.reply ? theme.good : theme.muted}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.catChip}><Text style={styles.catChipTxt}>{CAT_KO[t.category]}</Text></View>
              <Text style={{ color: t.status === 'refunded' ? theme.gold : t.reply ? theme.good : theme.warn, fontSize: 12, fontWeight: '800' }}>{STATUS_KO[t.status ?? (t.reply ? 'replied' : 'open')] ?? '답변 대기'}</Text>
            </View>
            <Text style={styles.tContent} numberOfLines={3}>{t.content}</Text>
            {t.reply ? (
              <View style={styles.reply}>
                <Text style={styles.replyLabel}>운영자 답변</Text>
                <Text style={styles.replyTxt}>{t.reply}</Text>
              </View>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

function Compose({ onDone }: { onDone: () => void }) {
  const [cat, setCat] = useState<TicketCategory>('bug');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  // 스냅샷은 스토어 상태에서 즉석 생성(순수). 무거우니 제출 성공 후 백그라운드 업로드.
  // 전지훈련(다이아 유일 소비처) 진단(§13.17) — diamonds/campLog/pendingCamp 동봉: "차감됐으나 미적용" 추적.
  const snapInput = useGameStore((s) => ({
    season: s.season, currentDay: s.currentDay, myTeamId: s.selectedTeamId ?? '',
    archive: s.archive, milestones: s.milestones, hallOfFame: s.hallOfFame,
    retirements: s.retirements, released: s.released, playerBase: s.playerBase,
    diamonds: s.diamonds, campLog: s.campLog, pendingCamp: s.pendingCamp,
  }));

  const submit = async () => {
    if (content.trim().length < 5) { Alert.alert('내용을 입력하세요', '조금 더 자세히 적어주시면 도움이 됩니다(5자 이상).'); return; }
    setSending(true);
    const r = await createTicket(cat, content.trim(), getDeviceInfo()); // 진단 기기정보 동봉(§13.17)
    setSending(false);
    if (!r.ok) {
      Alert.alert(r.reason === 'offline' ? '오프라인' : '전송 실패',
        r.reason === 'offline' ? '지금은 서버에 연결할 수 없습니다. 온라인일 때 다시 시도해 주세요.' : '잠시 후 다시 시도해 주세요.');
      return;
    }
    // 진단 스냅샷 비동기 첨부(최근 10시즌 재계산) — 실패해도 문의 자체는 접수됨.
    const ticketId = r.ticketId;
    void (async () => {
      try {
        const logs = await getSnapshotLogs(snapInput.season);
        const snapshot = buildDiagnosticSnapshot({
          ...snapInput, engineVersion: ENGINE_VERSION,
          players: Object.values(snapInput.playerBase ?? {}),
          logs, now: Date.now(),
          diamonds: snapInput.diamonds, campLog: snapInput.campLog, pendingCamp: snapInput.pendingCamp,
        });
        await uploadSnapshot(ticketId, snapshot);
      } catch { /* 스냅샷 실패는 문의 접수를 막지 않음 */ }
    })();
    Alert.alert('문의 접수', '문의가 접수되었습니다. 최근 기록 진단 정보가 함께 첨부됩니다. 답변은 이 화면에서 확인할 수 있어요.');
    onDone();
  };

  return (
    <Screen title="문의 등록">
      <View style={styles.topBar}>
        <Pressable onPress={onDone} hitSlop={10} style={styles.topBtn}><Text style={styles.newBtn}>취소</Text></Pressable>
      </View>
      <Muted style={{ fontSize: 12.5, marginBottom: 8 }}>분류를 고르고 내용을 적어주세요. 최근 10시즌의 진단 정보가 자동 첨부돼 분석에 도움이 됩니다.</Muted>
      <View style={styles.catRow}>
        {CATS.map((c) => (
          <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.cat, cat === c.key && styles.catOn]}>
            <Ionicons name={c.icon} size={18} color={cat === c.key ? theme.accent : theme.muted} />
            <Text style={[styles.catTxt, cat === c.key && { color: theme.accent }]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {cat === 'refund' ? (
        <View style={styles.refundNote}>
          <Text style={styles.refundNoteTxt}>
            • 환불 신청은 접수(문의)이며 자동 환불이 아닙니다. 검토 후 안내드립니다.{'\n'}
            • 결제 환불은 Google Play·App Store 정책에 따라 처리됩니다(판매 주체=스토어).{'\n'}
            • 정상적으로 소비된 다이아·완료된 특별훈련은 환불 대상이 아닙니다.{'\n'}
            • 다만 <Text style={{ fontWeight: '800', color: theme.text }}>결제 오류·중복 결제, 또는 다이아가 차감됐으나 특별훈련이 적용되지 않은 경우</Text>는 재화를 조정해 드립니다. 상황을 자세히 적어주세요.
          </Text>
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="어떤 점이 궁금하거나 불편하셨나요?"
        placeholderTextColor={theme.muted}
        value={content}
        onChangeText={setContent}
        multiline
        textAlignVertical="top"
      />
      <Pressable onPress={submit} disabled={sending} style={[styles.submit, sending && { opacity: 0.6 }]}>
        {sending ? <ActivityIndicator color="#04150E" /> : <Text style={styles.submitTxt}>문의 보내기</Text>}
      </Pressable>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  topBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  newBtn: { color: theme.accent, fontSize: 15, fontWeight: '800' },
  emptyBtn: { marginTop: 8, backgroundColor: theme.accentGlass, borderWidth: 1.5, borderColor: theme.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24 },
  emptyBtnTxt: { color: theme.accent, fontSize: 14, fontWeight: '800' },
  catChip: { backgroundColor: theme.cardAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  catChipTxt: { color: theme.text, fontSize: 12, fontWeight: '800' },
  tContent: { color: theme.text, fontSize: 14, marginTop: 6, lineHeight: 20 },
  reply: { marginTop: 8, backgroundColor: theme.good + '14', borderRadius: 10, padding: 10 },
  replyLabel: { color: theme.good, fontSize: 11, fontWeight: '800', marginBottom: 2 },
  replyTxt: { color: theme.text, fontSize: 13, lineHeight: 19 },
  refundNote: { backgroundColor: theme.warn + '14', borderWidth: 1, borderColor: theme.warn + '44', borderRadius: 10, padding: 11, marginBottom: 12 },
  refundNoteTxt: { color: theme.muted, fontSize: 12.5, lineHeight: 19 },
  catRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  cat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 10 },
  catOn: { backgroundColor: theme.accentGlass, borderColor: theme.accent },
  catTxt: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 160, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, color: theme.text, fontSize: 15, lineHeight: 22 },
  submit: { marginTop: 14, backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitTxt: { color: '#04150E', fontSize: 15, fontWeight: '900' },
}));

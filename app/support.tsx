// 문의하기 (BACKEND_SYSTEM §8·§13.6, #45 표면) — 마이페이지 진입. 목록(빈 상태) + 우상단 [문의] → 등록.
// 카테고리(오류/건의/질문/기타) + 내용. 제출 시 진단 스냅샷(최근 10시즌 재계산)을 **비동기로** 첨부.
// 서버는 lib/server.ts(throw 없음) — 오프라인이면 조용히 안내(온라인 연결 후 재시도). 관전/게임엔 영향 0.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { showAlert } from '../components/AppDialog';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Muted, Screen, theme, themedStyles } from '../components/Screen';
import { useGameStore, captureReplaySave } from '../store/useGameStore';
import { ENGINE_VERSION } from '../engine/match';
import { buildDiagnosticSnapshot } from '../data/diagnosticSnapshot';
import { getSnapshotLogs } from '../lib/deviceLog';
import {
  createTicket, listTickets, uploadSnapshot,
  type TicketCategory,
} from '../lib/server';
import { getDeviceInfo } from '../lib/device';
import { fmtDevnoteDate } from './devnotes'; // 날짜 표기 공통 헬퍼(YYYY.MM.DD — 공지·개발자노트와 동일 포맷)

const CATS: { key: TicketCategory; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'bug', label: '오류', icon: 'bug-outline' },
  { key: 'suggestion', label: '건의', icon: 'bulb-outline' },
  { key: 'question', label: '질문', icon: 'help-circle-outline' },
  { key: 'refund', label: '환불', icon: 'card-outline' },
  { key: 'etc', label: '기타', icon: 'ellipsis-horizontal-outline' },
];
const SUPPORT_MAX = 2000; // 문의 내용 입력 상한(서버는 4000 slice — 그보다 넉넉히 아래, UI-23). 최소 5자(trim)는 submit에서 검사
const CAT_KO: Record<TicketCategory, string> = { bug: '오류', suggestion: '건의', question: '질문', refund: '환불 신청', etc: '기타' };
// 상태 어휘는 **서버가 정본**(open|reviewing|answered|refunded, +레거시 replied|resolved) — 관리자 콘솔 라벨(대기/확인 중/답변완료/환불완료)과 일치시킨다.
// 2026-07-24: answered·reviewing이 빠져 있어 답변 완료 문의가 '답변 대기'로 표시되던 결함(BACKEND_SYSTEM §13.17 status 열거 드리프트가 뿌리) 수정.
const STATUS_KO: Record<string, string> = {
  open: '답변 대기', reviewing: '확인 중', answered: '답변 완료', refunded: '환불 완료',
  replied: '답변 완료', resolved: '답변 완료', // 레거시(구 어휘) — 콘솔과 동일하게 답변완료 취급
};
const ANSWERED = new Set(['answered', 'replied', 'resolved']); // 답변완료 계열(색상 판정)

type Ticket = { id: string; category: TicketCategory; content: string; status?: string; reply?: string; createdAt: string; repliedAt?: string | null };

export default function Support() {
  const [mode, setMode] = useState<'list' | 'compose'>('list');
  // 초안(분류·내용)은 부모에 리프트 — 컴포즈→목록 뒤로가기로 Compose가 언마운트돼도 입력이 살아남아 재진입 시 복원(2026-07-07).
  const [cat, setCat] = useState<TicketCategory>('bug');
  const [content, setContent] = useState('');
  const [tickets, setTickets] = useState<Ticket[] | null>(null); // null=로딩, []=빈, [...]=목록
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    setTickets(null);
    const r = await listTickets();
    if (r.ok) { setTickets(r.tickets); setOffline(false); }
    else { setTickets([]); setOffline(r.reason === 'offline'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 컴포즈 모드에서 뒤로가기(하드웨어/헤더/제스처)는 화면을 빠져나가지 말고 목록으로 — 입력 초안은 유지(위 리프트 상태라 보존).
  //   staleness 함정: 리스너 클로저가 초기 mode만 보면 안 됨 → modeRef로 fresh 값을 읽는다(training-camp pickedRef 패턴).
  const navigation = useNavigation();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      const t = e?.data?.action?.type;
      if (modeRef.current === 'compose' && (t === 'GO_BACK' || t === 'POP')) {
        e.preventDefault();
        setMode('list');
      }
    });
    return unsub;
  }, [navigation]);

  if (mode === 'compose') return (
    <Compose
      cat={cat} setCat={setCat}
      content={content} setContent={setContent}
      onCancel={() => setMode('list')}                                  // 취소도 초안 유지(재진입 복원)
      onDone={() => { setContent(''); setMode('list'); void load(); }}  // 제출 성공 시에만 초안 비움
    />
  );

  return (
    <Screen title="문의하기">
      <View style={styles.topBar}>
        <Pressable onPress={() => setMode('compose')} hitSlop={10} style={styles.topBtn}>
          <Ionicons name="create-outline" size={16} color={theme.accent} />
          <Text style={styles.newBtn}>문의하기</Text>
        </Pressable>
      </View>
      {tickets === null ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
      ) : tickets.length === 0 ? (
        <View style={{ paddingTop: 60, alignItems: 'center', gap: 8 }}>
          <Ionicons name="chatbubbles-outline" size={40} color={theme.muted} />
          <Muted style={{ fontSize: 14 }}>{offline ? '오프라인. 온라인 연결 후 문의 내역이 표시됩니다' : '문의 내역이 없습니다'}</Muted>
          <Muted style={{ fontSize: 12 }}>우측 상단 버튼으로 등록하세요.</Muted>
        </View>
      ) : (
        tickets.map((t) => {
          // 표시 상태 = 서버 status(없으면 답변 유무로 추정). 라벨·색 둘 다 같은 값에서 파생 —
          // "본문은 답변인데 라벨은 답변 대기"(2026-07-24 결함) 같은 화면 내 모순 차단.
          const st = t.status ?? (t.reply ? 'answered' : 'open');
          const done = ANSWERED.has(st) || !!t.reply;
          const stColor = st === 'refunded' ? theme.gold : done ? theme.good : theme.warn;
          const repliedAt = fmtDevnoteDate(t.repliedAt ?? null); // 답변 시각(YYYY.MM.DD — 노트·공지와 동일 포맷)
          return (
          <Card key={t.id} accent={done ? theme.good : theme.muted} flat>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.catChip}><Text style={styles.catChipTxt}>{CAT_KO[t.category]}</Text></View>
              <Text style={{ color: stColor, fontSize: 12, fontWeight: '800' }}>{STATUS_KO[st] ?? '답변 대기'}</Text>
            </View>
            <Text style={styles.tContent} numberOfLines={3}>{t.content}</Text>
            {t.reply ? (
              <View style={styles.reply}>
                <View style={styles.replyHead}>
                  <Text style={styles.replyLabel}>운영자 답변</Text>
                  {repliedAt ? <Text style={styles.replyDate}>{repliedAt}</Text> : null}
                </View>
                <Text style={styles.replyTxt}>{t.reply}</Text>
              </View>
            ) : null}
          </Card>
          );
        })
      )}
    </Screen>
  );
}

function Compose({ cat, setCat, content, setContent, onCancel, onDone }: {
  cat: TicketCategory; setCat: (c: TicketCategory) => void;
  content: string; setContent: (s: string) => void;
  onCancel: () => void; onDone: () => void;
}) {
  const [sending, setSending] = useState(false);

  // 스냅샷은 스토어 상태에서 즉석 생성(순수). 무거우니 제출 성공 후 백그라운드 업로드.
  // 전지훈련(다이아 유일 소비처) 진단(§13.17) — diamonds/campLog/pendingCamp 동봉: "차감됐으나 미적용" 추적.
  // ★ 개별 셀렉터로 뽑는다 — 셀렉터가 매 렌더 새 객체를 반환하면 zustand 기본 Object.is 비교가 항상 "변경"으로
  //   보고 무한 리렌더(Maximum update depth exceeded)에 빠진다(2026-07-03 수정). 스냅 객체는 submit에서 조립.
  const season = useGameStore((s) => s.season);
  const currentDay = useGameStore((s) => s.currentDay);
  const myTeamId = useGameStore((s) => s.selectedTeamId ?? '');
  const archive = useGameStore((s) => s.archive);
  const milestones = useGameStore((s) => s.milestones);
  const hallOfFame = useGameStore((s) => s.hallOfFame);
  const retirements = useGameStore((s) => s.retirements);
  const released = useGameStore((s) => s.released);
  const playerBase = useGameStore((s) => s.playerBase);
  const diamonds = useGameStore((s) => s.diamonds);
  const campLog = useGameStore((s) => s.campLog);
  const pendingCamp = useGameStore((s) => s.pendingCamp);
  const transfers = useGameStore((s) => s.transfers);
  const seasonDraftLog = useGameStore((s) => s.seasonDraftLog);
  const seasonForeignLog = useGameStore((s) => s.seasonForeignLog);

  const submit = async () => {
    if (content.trim().length < 5) { showAlert('내용을 입력하세요', '조금 더 자세히 적어주시면 도움이 됩니다(5자 이상).'); return; }
    setSending(true);
    const r = await createTicket(cat, content.trim(), getDeviceInfo()); // 진단 기기정보 동봉(§13.17)
    setSending(false);
    if (!r.ok) {
      showAlert(r.reason === 'offline' ? '오프라인' : '전송 실패',
        r.reason === 'offline' ? '지금은 서버에 연결할 수 없습니다. 온라인일 때 다시 시도해 주세요.' : '잠시 후 다시 시도해 주세요.');
      return;
    }
    // 진단 스냅샷 비동기 첨부(최근 10시즌 재계산) — 실패해도 문의 자체는 접수됨.
    const ticketId = r.ticketId;
    void (async () => {
      try {
        const logs = await getSnapshotLogs(season);
        const snapshot = buildDiagnosticSnapshot({
          season, currentDay, myTeamId, archive, milestones, hallOfFame,
          retirements, released, engineVersion: ENGINE_VERSION,
          players: Object.values(playerBase ?? {}),
          logs, now: Date.now(),
          diamonds, campLog, pendingCamp,
          transfers, seasonDraftLog, seasonForeignLog, // 선수 이동 연표(FA·드래프트·외국인) — 요약+movements 노출(2026-07-10)
          replay: captureReplaySave(), // 재현 키(§13.20 ①) — 전 문의 항상 첨부, 제출 시점 세이브 통째
        });
        await uploadSnapshot(ticketId, snapshot);
      } catch { /* 스냅샷 실패는 문의 접수를 막지 않음 */ }
    })();
    showAlert('문의 접수', '문의가 접수되었습니다. 최근 기록 진단 정보가 함께 첨부됩니다. 답변은 이 화면에서 확인할 수 있어요.');
    onDone();
  };

  return (
    <Screen title="문의 등록" keyboard>
      <View style={styles.topBar}>
        <Pressable onPress={onCancel} hitSlop={10} style={styles.topBtn}><Text style={styles.newBtn}>취소</Text></Pressable>
      </View>
      <Muted style={{ fontSize: 12.5, marginBottom: 8 }}>분류를 고르고 내용을 적어주세요. 최근 10시즌 진단 정보가 자동 첨부됩니다.</Muted>
      <View style={styles.catRow}>
        {CATS.map((c) => (
          <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.cat, cat === c.key && styles.catOn]}>
            <Ionicons name={c.icon} size={18} color={cat === c.key ? theme.accent : theme.muted} />
            <Text numberOfLines={1} style={[styles.catTxt, cat === c.key && { color: theme.accent }]}>{c.label}</Text>
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
        maxLength={SUPPORT_MAX}
      />
      <Text style={styles.counter}>{content.length} / {SUPPORT_MAX}</Text>
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
  replyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  replyLabel: { color: theme.good, fontSize: 11, fontWeight: '800' },
  replyDate: { color: theme.muted, fontSize: 11, fontWeight: '700' }, // 답변 시각(공지·개발자노트와 같은 YYYY.MM.DD)
  replyTxt: { color: theme.text, fontSize: 13, lineHeight: 19 },
  refundNote: { backgroundColor: theme.warn + '14', borderWidth: 1, borderColor: theme.warn + '44', borderRadius: 10, padding: 11, marginBottom: 12 },
  refundNoteTxt: { color: theme.muted, fontSize: 12.5, lineHeight: 19 },
  catRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  cat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 2 },
  catOn: { backgroundColor: theme.accentGlass, borderColor: theme.accent },
  catTxt: { color: theme.muted, fontSize: 12.5, fontWeight: '800' }, // 5칸(환불 추가)이라 좁은 폰 대비 살짝↓ + numberOfLines=1로 오버플로 방지
  input: { minHeight: 160, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, color: theme.text, fontSize: 15, lineHeight: 22 },
  counter: { color: theme.muted, fontSize: 11.5, textAlign: 'right', marginTop: 5 },
  submit: { marginTop: 14, backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitTxt: { color: '#04150E', fontSize: 15, fontWeight: '900' },
}));

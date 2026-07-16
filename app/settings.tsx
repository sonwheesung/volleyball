import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { ComponentProps } from 'react';
import { Muted, Screen, theme, themedStyles, useThemeMode, setThemeMode } from '../components/Screen';
import { showAlert, type DialogButton } from '../components/AppDialog';
import { ToastHost, useToastQueue } from '../components/Toast';
import { DEV_TOOLS } from '../data/flags';
import { seasonYear } from '../data/seasonLabel';
import { setBgmVolume as applyBgmVolume } from '../audio/bgm';
import { useGameStore, captureReplaySave, restoreSaveAtomic } from '../store/useGameStore';
import { buildExportPayload, serializeExport, exportFileName, parseImportPayload, dryRunImport } from '../lib/saveTransfer';
import { listBackups, fetchBackup } from '../lib/saveBackup';
import { useAuthStore } from '../store/useAuthStore';

const ROSE = '#FF5C8D';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function Row({ icon, tint, label, sub, onPress, danger }: { icon: IoniconName; tint: string; label: string; sub?: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: theme.bad }]}>{label}</Text>
        {sub ? <Muted style={{ fontSize: 12, marginTop: 1 }}>{sub}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.muted} /> : null}
    </Pressable>
  );
}

// 라디오 선택 행(2택) — "경기 지휘" 설정처럼 여러 선택지 중 하나를 고르는 UI. 기존 row 스타일 재사용.
function ChoiceRow({ selected, label, sub, onPress }: { selected: boolean; label: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { opacity: 0.7 } : null]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? theme.accent : theme.muted} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, selected && { color: theme.accent }]}>{label}</Text>
        <Muted style={{ fontSize: 12, marginTop: 2, lineHeight: 17 }}>{sub}</Muted>
      </View>
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const resetSave = useGameStore((s) => s.resetSave);
  const season = useGameStore((s) => s.season);
  const supporter = useGameStore((s) => s.supporter);
  const setSupporter = useGameStore((s) => s.setSupporter);
  const sfxEnabled = useGameStore((s) => s.sfxEnabled);
  const setSfx = useGameStore((s) => s.setSfx);
  const bgmVolume = useGameStore((s) => s.bgmVolume);
  const setBgmVolumeStore = useGameStore((s) => s.setBgmVolume);
  const mode = useThemeMode();
  const session = useAuthStore((s) => s.session);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const diamonds = useGameStore((s) => s.diamonds);
  // "경기 지휘" 설정(MATCH_INTERVENTION §4.1) — 현 유효값 = 로그에서 가장 늦은 날의 값(없으면 false=감독 자동).
  const coachModeLog = useGameStore((s) => s.coachModeLog);
  const setCoachMode = useGameStore((s) => s.setCoachMode);
  const coachManual = coachModeLog.reduce((acc, c) => (c.day >= acc.day ? c : acc), { day: -1, manual: false }).manual;
  const selectedTeamId = useGameStore((s) => s.selectedTeamId);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 세이브 가져오기 진행 중 블로킹(파일 I/O·rehydrate) — deleting과 같은 오버레이를 공유(신규 Modal 금지, #129).
  const [importing, setImporting] = useState(false);
  const toast = useToastQueue();
  // 블로킹 오버레이 문안(계정 삭제 / 세이브 가져오기 공용 — Modal 하나 재사용)
  const busy = deleting || importing;
  const busyTitle = deleting ? '계정을 삭제하는 중…' : '세이브를 불러오는 중…';
  const busyBody = deleting ? '잠시만 기다려 주세요.' : '파일에서 구단 진행을 복원하고 있어요.';

  // 계정 삭제(탈퇴, AUTH §7) — showAlert 2단 확인. 1차: 잔액·소멸 경고 / 2차: 최종 확인(destructive).
  const performDeleteAccount = async () => {
    setDeleting(true);
    const r = await deleteAccount();
    setDeleting(false);
    if (!r.ok) {
      showAlert(
        r.reason === 'offline' ? '온라인 연결 필요' : '삭제 실패',
        r.reason === 'offline'
          ? '계정 삭제는 온라인 연결이 필요합니다. 네트워크 확인 후 다시 시도해 주세요.'
          : '계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      );
    }
    // 성공 시 별도 네비 없음 — signOut으로 세션이 비면 BootGate가 로그인 화면으로 자동 전환
  };
  const askDeleteFinal = () => {
    showAlert('정말 삭제하시겠어요?', '이 작업은 되돌릴 수 없습니다. 계정과 개인정보가 삭제되고 로그인 화면으로 돌아갑니다.', [
      { text: '취소', style: 'cancel' },
      { text: '계정 삭제', style: 'destructive', onPress: () => { void performDeleteAccount(); } },
    ]);
  };
  const confirmDeleteAccount = () => {
    showAlert(
      '계정을 삭제할까요?',
      `보유 다이아 ${diamonds.toLocaleString()}개와 게임 진행이 이 계정에서 사라집니다. 같은 소셜 계정으로 다시 로그인해도 새 계정으로 시작되며, 구매한 다이아·구매 내역은 복구되지 않습니다. 환불이 필요하면 삭제 전에 문의해 주세요.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '계속', style: 'destructive', onPress: askDeleteFinal },
      ],
    );
  };
  // ── 세이브 내보내기(SAVE_SYSTEM §9.2) — captureReplaySave → 파일 → 공유 ──
  const onExport = async () => {
    const cap = captureReplaySave();
    if (!cap) { showAlert('내보낼 세이브가 없어요', '구단을 선택하고 진행한 뒤 내보낼 수 있어요.'); return; }
    try {
      const text = serializeExport(buildExportPayload(cap));
      const file = new File(Paths.cache, exportFileName(cap.state));
      file.create({ overwrite: true });
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: '세이브 내보내기' });
      } else {
        await Share.share({ message: text }); // 공유 시트 불가 기기 폴백(RN 코어) — 문자열 직접
      }
    } catch {
      showAlert('내보내기 실패', '세이브를 파일로 만드는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  // ── 세이브 가져오기(SAVE_SYSTEM §9.3) — 선택→파싱→드라이런 게이트→확인→적용 ──
  //   적용은 restoreSaveAtomic(쓰기 억제 래치, §9.3) — 동시 setState가 백업을 덮어쓰는 클로버 차단.
  //   expectedTeamId(백업의 selectedTeamId)와 로드 결과를 대조해 **조용한 오적용**(엉뚱한 구단 로드)을 실패로 잡는다.
  const applyImport = async (state: Record<string, unknown>, version: number, expectedTeamId: string) => {
    setImporting(true);
    try {
      const loaded = await restoreSaveAtomic(state, version); // migrate→merge→onRehydrate→commit (원자 구간)
      setImporting(false);
      if (loaded && loaded === expectedTeamId) {
        toast.push('세이브를 불러왔어요.');
        router.replace('/(tabs)');
      } else {
        // 로드된 구단이 백업과 불일치(클로버 잔여) 또는 안전망 fresh 리셋 — 조용한 오적용 대신 명시 실패.
        showAlert('가져오기 실패', '세이브를 복원하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    } catch {
      setImporting(false);
      showAlert('가져오기 실패', '세이브를 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.');
    }
  };
  const onImport = async () => {
    let res: DocumentPicker.DocumentPickerResult;
    try {
      res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false });
    } catch {
      showAlert('파일을 열 수 없어요', '파일 선택 중 문제가 발생했어요. 다시 시도해 주세요.');
      return;
    }
    if (res.canceled || !res.assets?.length) return;
    let text: string;
    try {
      text = await new File(res.assets[0].uri).text();
    } catch {
      showAlert('파일을 읽을 수 없어요', '선택한 파일을 읽지 못했어요. 다른 파일로 시도해 주세요.');
      return;
    }
    const parsed = parseImportPayload(text);
    if (!parsed.ok) { showAlert('가져올 수 없어요', parsed.reason); return; }
    // 드라이런 게이트 — 스토리지 쓰기 전 순수 검증(실패 시 현재 세이브 무접촉)
    const dry = dryRunImport(parsed.state, parsed.version);
    if (!dry.ok) { showAlert('가져올 수 없어요', dry.reason); return; }
    const expectedTeam = String(dry.sanitized.selectedTeamId); // 정규화된 백업 구단 — 로드 결과 대조용
    showAlert(
      '이 세이브로 대체할까요?',
      "현재 구단 진행이 선택한 세이브로 대체됩니다. 되돌릴 수 없어요 — 먼저 '내보내기'로 백업해 두는 걸 권장해요.\n\n다이아·결제 재화는 이 파일이 아니라 계정에 안전하게 보관돼요(이 파일은 구단 진행만 담아요).",
      [
        { text: '취소', style: 'cancel' },
        { text: '가져오기', style: 'destructive', onPress: () => { void applyImport(parsed.state, parsed.version, expectedTeam); } },
      ],
    );
  };

  // ── 서버 백업에서 복원(SAVE_SYSTEM §10.4) — 목록→선택→다운로드→기존 가져오기 파이프라인 재사용 ──
  const fmtBackupSize = (bytes: number) => (bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${Math.max(1, Math.round(bytes))}B`);
  const fmtBackupDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };
  // 선택한 서버 백업 다운로드 → §9.3 가져오기 게이트(parse→dryRun→확인→적용) 그대로.
  const onPickServerBackup = async (id: string) => {
    setImporting(true);
    const r = await fetchBackup(id);
    if (!r.ok) {
      setImporting(false);
      showAlert('불러올 수 없어요', r.reason === 'offline' ? '온라인 연결이 필요해요. 네트워크 확인 후 다시 시도해 주세요.' : '백업을 내려받는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setImporting(false);
    const parsed = parseImportPayload(r.payload);
    if (!parsed.ok) { showAlert('복원할 수 없어요', parsed.reason); return; }
    const dry = dryRunImport(parsed.state, parsed.version);
    if (!dry.ok) { showAlert('복원할 수 없어요', dry.reason); return; }
    const expectedTeam = String(dry.sanitized.selectedTeamId); // 정규화된 백업 구단 — 로드 결과 대조용
    showAlert(
      '이 백업으로 복원할까요?',
      '현재 구단 진행이 선택한 서버 백업으로 대체됩니다. 되돌릴 수 없어요.\n\n다이아·결제 재화는 이 백업이 아니라 계정에 안전하게 보관돼요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '복원', style: 'destructive', onPress: () => { void applyImport(parsed.state, parsed.version, expectedTeam); } },
      ],
    );
  };
  const onServerRestore = async () => {
    setImporting(true);
    const r = await listBackups();
    setImporting(false);
    if (!r.ok) {
      showAlert(
        r.reason === 'unauthorized' ? '로그인이 필요해요' : '불러올 수 없어요',
        r.reason === 'offline' ? '온라인 연결이 필요해요. 네트워크 확인 후 다시 시도해 주세요.'
          : r.reason === 'unauthorized' ? '서버 백업은 로그인 후 이용할 수 있어요.'
          : '서버 백업 목록을 불러오는 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.',
      );
      return;
    }
    if (r.backups.length === 0) {
      showAlert('서버 백업이 없어요', '시즌이 끝날 때마다 자동으로 서버에 백업돼요. 한 시즌을 마치면 여기서 복원할 수 있어요.');
      return;
    }
    // 최대 5개(서버 유지분) 행 + 취소 — 기존 showAlert 세로 버튼 스택(신규 Modal 금지 #129).
    const buttons: DialogButton[] = r.backups.map((b) => ({
      text: `${seasonYear(b.season)} · ${fmtBackupDate(b.createdAt)} · ${fmtBackupSize(b.sizeBytes)}`,
      onPress: () => { void onPickServerBackup(b.id); },
    }));
    buttons.push({ text: '취소', style: 'cancel' });
    showAlert('서버 백업에서 복원', '복원할 백업을 선택하세요. 현재 구단 진행이 대체돼요.', buttons);
  };

  // 슬라이더 라이브 값(드래그 중 즉시 청음 반영 — 렌더 churn과 스토어 커밋 분리, SOUND_SYSTEM §3)
  const [bgmLive, setBgmLive] = useState(bgmVolume);

  const version = (Constants.expoConfig?.version as string) ?? '0.1.0';

  return (
    <Screen title="설정" overlay={<ToastHost toasts={toast.toasts} />}>
      <Muted>게임 · 데이터 · 정보를 관리합니다.</Muted>

      {/* 응원 섹션(서포터 팩·크레딧) — 출시 전 임시 숨김(2026-06-28, 사용자 요청). IAP 연결 시 복원.
      <Text style={styles.section}>응원</Text>
      <View style={styles.group}>
        <Row icon="heart" tint={ROSE}
          label={supporter ? '서포터 ♥, 감사합니다' : '서포터 팩'}
          sub={supporter ? '배구명가를 응원해주셨어요' : '한 번의 응원으로 다음 시즌을 함께'}
          onPress={() => router.push('/supporter')} />
        <Row icon="document-text-outline" tint={theme.muted} label="크레딧" sub="만든 사람 · 응원해주신 분들"
          onPress={() => router.push('/credits')} />
      </View>
      */}

      <Text style={styles.section}>게임</Text>
      <View style={styles.group}>
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={sfxEnabled ? 'volume-high-outline' : 'volume-mute-outline'} size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>효과음</Text>
            <Muted style={{ fontSize: 12, marginTop: 1 }}>경기 보드 휘슬·스파이크·서브 소리 (무음 모드 존중)</Muted>
          </View>
          <Switch value={sfxEnabled} onValueChange={setSfx} trackColor={{ true: theme.accent, false: theme.cardAlt }} />
        </View>
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={bgmLive > 0 ? 'musical-notes-outline' : 'musical-note-outline'} size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>배경음악</Text>
            <Muted style={{ fontSize: 12, marginTop: 1 }}>{`앱 배경에 흐르는 음악 · ${Math.round(bgmLive * 100)}%`}</Muted>
            <Slider
              style={{ width: '100%', height: 32, marginTop: 4 }}
              minimumValue={0}
              maximumValue={1}
              value={bgmLive}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.cardAlt}
              thumbTintColor={theme.accent}
              onValueChange={(v) => { setBgmLive(v); applyBgmVolume(v); }}
              onSlidingComplete={(v) => setBgmVolumeStore(v)}
            />
          </View>
        </View>
        <View style={styles.toggleRow}>
          <View style={[styles.rowIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={mode === 'light' ? 'sunny-outline' : 'moon-outline'} size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>라이트 모드</Text>
            <Muted style={{ fontSize: 12, marginTop: 1 }}>밝은 화면 테마 (끄면 다크). 적용 시 화면이 새로 그려집니다</Muted>
          </View>
          <Switch value={mode === 'light'} onValueChange={(v) => setThemeMode(v ? 'light' : 'dark')} trackColor={{ true: theme.accent, false: theme.cardAlt }} />
        </View>
      </View>

      <Text style={styles.section}>경기 지휘</Text>
      <View style={styles.group}>
        <ChoiceRow
          selected={!coachManual}
          label="감독 자동"
          sub="타임아웃과 선수 교체를 감독이 알아서 해요 (기존 방식)"
          onPress={() => { if (coachManual) setCoachMode(false); }}
        />
        <ChoiceRow
          selected={coachManual}
          label="구단주 직접"
          sub="내 팀 경기의 타임아웃·교체를 관전 중 직접 해요. 관전하지 않는 경기에서는 타임아웃·교체 없이 진행돼 불리할 수 있어요."
          onPress={() => { if (!coachManual) setCoachMode(true); }}
        />
      </View>
      <Muted style={{ fontSize: 11, marginTop: 6, marginLeft: 2 }}>변경은 다음 경기부터 적용돼요.</Muted>

      <Text style={styles.section}>세이브 관리</Text>
      <View style={styles.group}>
        <Row icon="download-outline" tint={theme.accent} label="세이브 내보내기"
          sub={selectedTeamId ? '구단 진행을 파일로 저장 · 공유 (백업 · 기기 이전)' : '진행 중인 구단이 없어요'}
          onPress={selectedTeamId ? () => { void onExport(); } : undefined} />
        <Row icon="cloud-upload-outline" tint={theme.accent} label="세이브 가져오기"
          sub="파일에서 불러오기 · 현재 진행을 대체해요"
          onPress={() => { void onImport(); }} />
        <Row icon="cloud-download-outline" tint={theme.accent} label="서버 백업에서 복원"
          sub="시즌마다 자동 백업된 목록에서 복원 · 현재 진행을 대체해요"
          onPress={() => { void onServerRestore(); }} />
      </View>
      <Muted style={{ fontSize: 11, marginTop: 6, marginLeft: 2 }}>시즌이 끝날 때마다 자동으로 서버에 백업돼요(최근 5개). 다이아·결제 재화는 계정에 항상 안전해요.</Muted>

      <Text style={styles.section}>데이터</Text>
      <View style={styles.group}>
        <Row icon="refresh-outline" tint={theme.bad} label="세이브 초기화" sub={`현재 ${seasonYear(season)}. 구단 변경(진행 기록 삭제)`} danger
          onPress={() => setConfirmReset(true)} />
        {session ? (
          <Row icon="person-remove-outline" tint={theme.bad} label="계정 삭제" sub="탈퇴 · 개인정보 삭제. 되돌릴 수 없습니다" danger
            onPress={confirmDeleteAccount} />
        ) : null}
      </View>

      <Text style={styles.section}>정보</Text>
      <View style={styles.group}>
        <Row icon="information-circle-outline" tint={theme.muted} label="버전" sub={`배구명가 v${version}`} />
      </View>

      {/* 미리보기(개발용) — 실전 빌드에선 숨김. 서포터 적용된 모습을 즉시 확인 */}
      {DEV_TOOLS ? (
        <>
          <Text style={styles.section}>미리보기 (개발)</Text>
          <View style={styles.group}>
            <View style={styles.toggleRow}>
              <View style={[styles.rowIcon, { backgroundColor: ROSE + '1A' }]}>
                <Ionicons name="heart" size={18} color={ROSE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>서포터 보유 (적용 미리보기)</Text>
                <Muted style={{ fontSize: 12, marginTop: 1 }}>켜면 실제로 산 것처럼 ♥·크레딧·감사 화면 표시</Muted>
              </View>
              <Switch value={supporter} onValueChange={setSupporter} trackColor={{ true: ROSE, false: theme.cardAlt }} />
            </View>
          </View>
        </>
      ) : null}

      {/* 세이브 초기화 확인 — 되돌릴 수 없는 작업이라 명시 확인 */}
      <Modal visible={confirmReset} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setConfirmReset(false)}>
        <Pressable style={styles.backdrop} onPress={() => setConfirmReset(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <View style={[styles.rowIcon, { backgroundColor: theme.bad + '1A', alignSelf: 'center', width: 48, height: 48, borderRadius: 14 }]}>
              <Ionicons name="warning-outline" size={24} color={theme.bad} />
            </View>
            <Text style={styles.modalTitle}>세이브를 초기화할까요?</Text>
            <Text style={styles.modalBody}>현재 구단의 모든 진행 기록(시즌·계약·기록)이 사라지고 구단 선택으로 돌아갑니다. 되돌릴 수 없습니다.</Text>
            <View style={styles.modalBtns}>
              <Pressable style={[styles.mBtn, styles.mGhost]} onPress={() => setConfirmReset(false)}>
                <Text style={styles.mGhostText}>취소</Text>
              </Pressable>
              <Pressable style={[styles.mBtn, styles.mDanger]} onPress={() => { setConfirmReset(false); resetSave(); router.replace('/select-team'); }}>
                <Text style={styles.mDangerText}>초기화</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 블로킹 오버레이(계정 삭제 / 세이브 가져오기 공용) — 무거운 작업 동안 재입력 차단(UI_RULES). 신규 Modal 금지(#129)로 하나를 공유. */}
      <Modal visible={busy} transparent statusBarTranslucent animationType="fade">
        <View style={styles.backdrop}>
          <View style={[styles.modal, { alignItems: 'center', gap: 14 }]}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.modalTitle}>{busyTitle}</Text>
            <Text style={styles.modalBody}>{busyBody}</Text>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  section: { color: theme.muted, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 6, marginLeft: 2 },
  group: { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: '#15202B80', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modal: { backgroundColor: theme.card, borderRadius: 18, padding: 22, gap: 12, alignSelf: 'stretch' },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  modalBody: { color: theme.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  mBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  mGhost: { backgroundColor: theme.cardAlt },
  mGhostText: { color: theme.text, fontSize: 15, fontWeight: '800' },
  mDanger: { backgroundColor: theme.bad },
  mDangerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
}));

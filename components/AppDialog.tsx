// 앱 전역 커스텀 다이얼로그 (UI-21) — 네이티브 Alert.alert(OS 흰 창) 완전 대체.
// 명령형 API `showAlert(title, message?, buttons?)`가 Alert.alert와 동일 시그니처라 치환이 1:1.
// 루트(app/_layout.tsx)에 <DialogHost/> 하나만 마운트하면 모든 화면이 상태 추가 없이 이 모달을 띄운다.
// 스타일은 공용 Popup(다크 글래스 카드) 위에 버튼 목록을 그린다. 버튼 style: default=민트 / cancel=중립 / destructive=코랄.
import { create } from 'zustand';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Popup } from './Popup';
import { theme } from './Screen';
import { themedStyles } from './theme';

export interface DialogButton { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }
interface DialogState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: DialogButton[];
  show: (title: string, message?: string, buttons?: DialogButton[]) => void;
  hide: () => void;
}
const useDialog = create<DialogState>((set) => ({
  visible: false, title: '', message: undefined, buttons: [],
  show: (title, message, buttons) =>
    set({ visible: true, title, message, buttons: buttons && buttons.length ? buttons : [{ text: '확인' }] }),
  hide: () => set({ visible: false }),
}));

/** Alert.alert 대체 — 동일 시그니처. 이벤트 핸들러에서만 호출(렌더 중 호출 금지). */
export function showAlert(title: string, message?: string, buttons?: DialogButton[]): void {
  useDialog.getState().show(title, message, buttons);
}

export function DialogHost() {
  const { visible, title, message, buttons, hide } = useDialog();
  // 취소 성격 버튼이 있으면 배경 탭으로 닫힘(그 버튼 동작 없이 그냥 닫힘 — Alert의 바깥탭=취소 관례)
  const hasCancel = buttons.some((b) => b.style === 'cancel');
  const row = buttons.length === 2; // 2개(예: 취소/확인)는 가로, 그 외는 세로 스택
  return (
    <Popup visible={visible} onRequestClose={hide} dismissable={hasCancel} card={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={[styles.btns, row ? styles.btnsRow : styles.btnsCol]}>
        {buttons.map((b, i) => {
          const kind = b.style ?? 'default';
          const box = kind === 'destructive' ? styles.destructive : kind === 'cancel' ? styles.cancel : styles.default;
          const txt = kind === 'destructive' ? styles.destructiveTxt : kind === 'cancel' ? styles.cancelTxt : styles.defaultTxt;
          return (
            <Pressable
              key={i}
              onPress={() => { hide(); b.onPress?.(); }}
              style={({ pressed }) => [styles.btn, box, row && { flex: 1 }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.btnTxt, txt]}>{b.text}</Text>
            </Pressable>
          );
        })}
      </View>
    </Popup>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: { gap: 10, maxWidth: 420 },
  title: { color: theme.text, fontSize: 18, fontWeight: '900' },
  message: { color: theme.muted, fontSize: 13.5, lineHeight: 20 },
  btns: { marginTop: 4, gap: 8 },
  btnsRow: { flexDirection: 'row' },
  btnsCol: { flexDirection: 'column' },
  btn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  btnTxt: { fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  default: { backgroundColor: theme.accentGlass, borderColor: theme.accent },
  defaultTxt: { color: theme.accent },
  destructive: { backgroundColor: theme.bad + '1A', borderColor: theme.bad },
  destructiveTxt: { color: theme.bad },
  cancel: { backgroundColor: theme.cardAlt, borderColor: theme.border },
  cancelTxt: { color: theme.text },
}));

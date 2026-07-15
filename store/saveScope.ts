// 계정별 세이브 슬롯 전환 (SAVE_SYSTEM §7) — 계정↔슬롯 스코프의 단일 진실.
//
// 세이브 키는 계정별(`baeknyeon-save:<userId>`). 로그인 성공/콜드 부팅 캐시 세션 시 switchSaveScope가
// ①대기 쓰기 flush(현재=이전 계정 키로) ②레거시 1회 이관 ③persist 키 교체+리그 레지스트리 리셋
// ④슬롯 유무 분기(빈 슬롯=freshSave / 기존 슬롯=rehydrate) ⑤saveScopeUserId 세팅. 결정론·스키마는 불변(키만 바뀜).
//
// 순환 의존 주의: useGameStore가 useAuthStore를 top-level import한다. useAuthStore는 이 모듈을 **동적 import**해
//   순환을 끊는다(app/_layout은 정적 import 가능 — 사이클 없음).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGameStore, SAVE_KEY } from './useGameStore';
import { flushGameSave } from './persistStorage';
import { resetLeagueBase } from '../data/league';
import { FRESH_AD_STATE } from '../engine/diamonds';

/** 계정별 세이브 키(§7.1). userId = 세션 userId(google:… / dev-local:…). */
export const saveKeyFor = (userId: string): string => `${SAVE_KEY}:${userId}`;

// 전환 직렬화(§7.3) — 프라미스 체인으로 겹치는 전환을 순서대로. activeScope=마지막으로 스코프를 **시작**한 계정.
//   같은 계정으로의 재요청(로그인 시퀀스 + 부팅 이펙트 중복 호출·재로그인)은 no-op으로 합쳐진다.
let activeScope: string | null = null;
let scopeChain: Promise<void> = Promise.resolve();

/** 계정 슬롯으로 게임 스토어를 전환(§7.3). 같은 계정이면 no-op(재로그인/중복 트리거 안전). */
export function switchSaveScope(userId: string): Promise<void> {
  if (activeScope === userId) return scopeChain; // 이미 그 계정으로 스코프됨/진행 중 — 재실행 안 함
  activeScope = userId;
  scopeChain = scopeChain.then(() => doSwitch(userId)).catch((e) => { console.warn('[saveScope] switch failed', e); });
  return scopeChain;
}

async function doSwitch(userId: string): Promise<void> {
  const newKey = saveKeyFor(userId);
  // ① 현재(이전 계정) 키로 대기 쓰기 flush — 유실·지연 오염 방지(§7.4 함정 b, 이중 방어의 명시 쪽)
  await flushGameSave();
  // ② 레거시(고정 키) 세이브 1회 이관 — 새 슬롯이 비었고 레거시가 있으면 rename(복사+삭제)
  const existing = await AsyncStorage.getItem(newKey);
  if (existing == null) {
    const legacy = await AsyncStorage.getItem(SAVE_KEY);
    if (legacy != null) { await AsyncStorage.setItem(newKey, legacy); await AsyncStorage.removeItem(SAVE_KEY); }
  }
  const raw = await AsyncStorage.getItem(newKey); // 이관 반영 후 재조회
  // ③ persist 키 교체 + 이전 계정 리그 레지스트리 비움(빈 슬롯이면 시드로 폴백, 기존 슬롯이면 rehydrate가 커밋)
  useGameStore.persist.setOptions({ name: newKey });
  resetLeagueBase();
  if (raw == null) {
    // ④ 빈 슬롯 = 신규 계정 → 완전 초기화(온보딩/구단선택부터). resetSave가 컨텍스트까지 리셋하되 계정 캐시를 이전 계정 것으로
    //    보존하므로(_dv_reset_preserve), 여기선 새 계정용으로 0화한다(서버 syncWallet이 이후 수렴).
    useGameStore.getState().resetSave();
    useGameStore.setState({ diamonds: 0, claimedAch: [], adState: { ...FRESH_AD_STATE }, hydrated: true, saveScopeUserId: userId });
  } else {
    // ④ 기존 슬롯 = 복귀 계정 → rehydrate. merge가 sanitizeSave로 전 필드를 그 슬롯 값으로 덮어써 이전 계정 데이터 누출 0.
    await useGameStore.persist.rehydrate(); // onRehydrateStorage가 hydrated=true·base 커밋
    useGameStore.setState({ saveScopeUserId: userId });
  }
}

/** 계정 슬롯 로컬 파기(§7.7) — 계정 삭제 시. activeScope도 리셋해 재로그인 시 재스코프(빈 슬롯=fresh). */
export async function deleteSaveSlot(userId: string): Promise<void> {
  try { await AsyncStorage.removeItem(saveKeyFor(userId)); } catch { /* 로컬 파기 실패는 무해(다음 부팅 재시도 불필요 — 서버가 진실) */ }
  if (activeScope === userId) activeScope = null;
}

/** 테스트 훅(가드 전용) — 프로세스 내 전환 상태 리셋. 앱 런타임에선 호출 안 함. */
export function _resetScopeForTest(): void { activeScope = null; scopeChain = Promise.resolve(); }

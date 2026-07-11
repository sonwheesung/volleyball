// 시즌 시작 로딩 (SEASON_SYSTEM §5.5 D) — "시즌 시작하기"(광고 후) → endSeason은 무거운 동기 작업이라
// 화면이 멈춘 듯 보였다(사용자 보고). 브랜드 로딩을 **먼저 그리고 화면 전환이 끝난 뒤** endSeason을 돌려 로딩이
// 실제로 보이게 한다. ⚠ runAfterInteractions는 전환/페인트 전에 일찍 발화해 직전 화면(드래프트)이 그대로
// 얼어붙었다(실기기 확인 2026-06-30) → 전환 시간(≈350ms)을 넘긴 setTimeout + 2×RAF로 페인트 보장 후 실행.
// ⚠ 로더는 단순 원형 스피너(2026-06-30 사용자 요청): endSeason 동기 블록 중엔 메시지 회전(setInterval)도, 네이티브
//   애니(useNativeDriver)도 에뮬에서 멈춘다(실측 — 블록 전 프레임만 움직임). 멈춘 회전 링은 거슬리지 않지만 첫
//   메시지로 고정된다. 블록 내내 돌고 메시지가 순차로 바뀌게 하려면 endSeason 청크화 필요(SEASON_SYSTEM §5.5 D 미결).
import { useEffect, useRef, useState } from 'react';
import { useRouter, useNavigation } from 'expo-router';
import { BackHandler } from 'react-native';
import { Loading } from '../components/Screen';
import { logError } from '../lib/log';
import { useGameStore } from '../store/useGameStore';

// 개막 장면 플레이버(2026-07-11 테스터 — 재계산 문구 대신 경기장 준비 장면). 회전 노출.
const MSGS = [
  '코트를 닦고 라인을 긋는 중…',
  '네트 높이를 맞추는 중…',
  '배구공에 바람을 넣는 중…',
  '선수단을 소집하는 중…',
  '워밍업 스트레칭 중…',
  '관중석에 불이 켜지는 중…',
];
const PAINT_DELAY = 500; // 화면 전환(≈350ms) + 첫 페인트 여유 — 이 동안 브랜드 로딩이 뜨고 공이 통통 튄다

export default function SeasonStart() {
  const router = useRouter();
  const endSeason = useGameStore((s) => s.endSeason);
  const [msg, setMsg] = useState(MSGS[0]);
  const ran = useRef(false);

  // 로딩(endSeason 실행) 중 하드웨어 백·POP 무력화(C) — 타이머 취소로 endSeason이 안 도는 걸 방지.
  //   replace('/enshrine')(REPLACE)만 통과시켜 정상 진행.
  const navigation = useNavigation();
  useEffect(() => {
    const onBack = () => true;
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    const unsub = (navigation as any).addListener('beforeRemove', (e: any) => {
      const t = e?.data?.action?.type;
      if (t === 'GO_BACK' || t === 'POP') e.preventDefault();
    });
    return () => { sub.remove(); unsub(); };
  }, [navigation]);

  useEffect(() => {
    let i = 0;
    let raf1 = 0;
    let raf2 = 0;
    const iv = setInterval(() => { i = (i + 1) % MSGS.length; setMsg(MSGS[i]); }, 700);
    // 전환이 끝나 로딩이 최상단으로 그려진 뒤(setTimeout) + 실제 페인트 한 프레임 보장(2×RAF) → endSeason(동기 블록)
    const timer = setTimeout(() => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (ran.current) return;
          ran.current = true;
          try { endSeason(); } catch (e) { logError('seasonStart.endSeason', e); }
          clearInterval(iv);
          // endSeason 직후 currentDay=0(새 로스터 확정) → 헌액(지난 시즌 마무리) → 전지훈련(A3, day0 제약) → 개막 브리지 → 대시보드.
          //   순서 변경(2026-07-08 사용자 결정): 과거(헌액=은퇴자 기림)를 먼저 마무리하고 미래(전훈=새 시즌 준비)를 준비한 뒤 개막.
          router.replace('/enshrine');
        });
      });
    }, PAINT_DELAY);
    return () => {
      clearInterval(iv);
      clearTimeout(timer);
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [endSeason, router]);

  return <Loading variant="brand" message={msg} />;
}

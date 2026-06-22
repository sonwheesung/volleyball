# 배구 엔진 테스트 콘솔 (sim-web)

PC 브라우저에서 게임 엔진(`engine/`·`data/`)을 직접 돌려 결과를 검증하는 **백엔드 없는** 콘솔.
RN·AsyncStorage·expo 의존은 `_stubs/`로 무력화(엔진은 순수 TS라 실제로 안 씀). 앱(Expo)과 별개.

## 실행
```
npm run sim:web          # 빌드+감시+정적 서버 → http://localhost:5051/ (폰: http://<PC IP>:5051/)
npm run sim:web:build    # 1회 빌드만 (sim-web/index.html 을 그냥 열어도 됨)
```
> 포트 5051(사도전 콘솔이 5050이라 충돌 회피). `--port=NNNN` 으로 변경 가능.

## 구성
- `build.cjs` — esbuild 번들(`main.ts` → `dist/bundle.js`) + `--serve` 정적 서버.
- `index.html` — 콘솔 UI(탭·폼·결과). `main.ts` — 폼 읽어 엔진 실행 → 렌더.
- `_stubs/` — react-native·async-storage no-op 스텁.

## 탭
- **경기** ✅ — 두 팀 골라 1경기(박스스코어) 또는 N경기(승률·세트 분포).
- **관계 · 선수 심리** ✅ — 팀 로스터별 벤치 사유·기분(불만/무감정/만족)·출전갈망·주전 기대치·재계약 거부율(ROTATION_MORALE).
- **연봉 산정** ✅ — 생산·OVR·나이→시장가치 vs 실제 연봉(고/저평가)·팀 총연봉 vs 샐러리캡(salary·cap).
- **FA 시장** ✅ — 리그 전체 FA 자격 풀 + 등급(A/B/C)·요구 연봉(faMarket).
- **영입 · 드래프트** ✅ — 다음 시즌 신인 드래프트 클래스 + OVR·포텐셜(draftSetup).
- 분포(KOVO)·시즌 등 — 추가 예정.

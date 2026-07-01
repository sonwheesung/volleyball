---
name: engine-regression
description: Run the deterministic 48k-match engine regression harness (KOVO distribution ratios + ΔOVR win-rate curve + q-dominance symmetry) as an A/B baseline before and after any match-engine coefficient change. Invoke when about to tune or after tuning engine numbers — rally.ts / ratings.ts / overall.ts / aging.ts / training.ts / match.ts coefficients (기복 weight, parity sensitivity, block/dig/serve/attack coefficients, aging rates, stat weights) — or when the user says "회귀 돌려", "회귀 테스트", "엔진 회귀", "밸런스 재측정", "before/after 비교", "run regression". Answers "did this change break balance?" objectively instead of by feel.
---

# engine-regression — 경기 엔진 회귀 하네스 (A/B)

> **왜**: 경기 엔진 계수 하나(기복 비중·parity 민감도·블록/디그/공격 계수·노쇠율·스탯 가중)를 바꾸면
> 밸런스가 조용히 깨질 수 있다. "느낌"이 아니라 **48,000경기 실측**으로 before/after를 비교해
> "이 변경이 밸런스를 깼나?"를 객관적으로 판정한다. 사용자 제안(2026-07-01)으로 도입.
>
> 핵심 원칙: **추정 금지 — 계수 바꾸면 반드시 이 하네스로 A/B**([[no-guessing-run-stats]]·STATS_PROTOCOL).

## 무엇을 재는가 (3블록)

`tools/simEngineRegression.ts` — 자체완결·결정론(합성 팀, 스토어 무관, 고정 시드). 같은 인자 = 같은 숫자.

1. **분포 비율(스케일 무관)** — 공격성공률·블록아웃·스터프·공격범실·에이스·서브범실·리시브범실·디그율·평균 랠리 hop. 계수를 바꾸면 여기가 움직인다.
2. **ΔdisplayOVR → 상위팀 승률 곡선** — parity(OVR 체감). Δ커질수록 승률↑가 유지되는지. 너무 평평=OVR 안 느껴짐, 너무 가파름=업셋 없음.
3. **동률팀 단일축 우위 승률(리시브 vs 공격)** — q 지배 여부. 둘이 대칭이어야 리시브가 경기를 독식 안 함.

> ⚠ 합성 팀 기준이라 **절대값은 `simKovo`(리그 팀)와 다르다** — 그건 정상. 이 하네스의 용도는 **A/B 상대 비교**(계수 변경 전후 diff)이지 KOVO 절대 캘리브레이션이 아니다. 절대 KOVO 검증은 `tools/simKovo.ts`(리그 팀·세트당 환산·목표 범위)로 따로 본다.

## 실행 (A/B 프로토콜)

```bash
# 1) 변경 전 — 베이스라인 저장
npx tsx tools/simEngineRegression.ts 1200 40 > /tmp/reg_before.txt   # 48k경기(~수분). 빠른확인은 300 20

# 2) 계수 변경(rally.ts/ratings.ts/aging.ts 등)

# 3) 변경 후 — 비교
npx tsx tools/simEngineRegression.ts 1200 40 > /tmp/reg_after.txt
diff /tmp/reg_before.txt /tmp/reg_after.txt
```
- 인자: `[pairs=1200] [matchesPerPair=40]` → 48,000경기. 빠른 스모크는 `300 20`(6k).
- **의도한 지표만 움직이고 나머지는 유지**되면 안전. 예: 노쇠율만 바꿨는데 공격성공률·에이스율이 크게 흔들리면 부작용.

## 기준 베이스라인 (엔진 미변경 상태, 48k · 2026-07-01)

> 계수 변경 후 이 값에서 크게 벗어나면(±2%p↑) 원인을 규명한다. **엔진 로직을 바꾸면 이 베이스라인도 재측정·갱신**(STATS_PROTOCOL: 로직 변경 시 기존 통계 무효).

```
분포:  공격성공률 37.11% · 블록아웃 2.15% · 스터프 6.10% · 공격범실 6.12%
       에이스 5.32% · 서브범실 8.62% · 리시브범실 3.06% · 디그율 45.37% · 랠리hop 1.532
ΔOVR 곡선:  0-1=50.9% · 1-3=60.6% · 3-5=70.3% · 5-7=81.3% · 7-9=88.0%
            9-11=93.4% · 11-13=96.3% · 13-16=98.3% · 16+=99.6%
q대칭:  Δrecv 2-5=58.1% ≈ Δspk 2-5=58.8% (대칭=리시브 독식 없음)
```

## 판정 가이드
- **분포 비율**: 목표 지표만 이동, 나머지 ±1%p 내 유지 = 국소 변경 성공. 여러 지표가 동반 이동 = 파급(재검토).
- **ΔOVR 곡선**: Δ0-1≈50%(동전)·Δ3-5≈70%·Δ5-7≈80%·Δ9-11≈94% 대가 유지되면 parity 정상. 전체가 평평해지면 OVR 체감↓(과압축), 전체가 가팔라지면 업셋↓.
- **리시브 vs 공격 대칭**: 두 축 승률이 비슷(±3%p)해야 q 지배 아님. 리시브가 공격보다 훨씬 높아지면 q 과중.
- 검증 안 된 계수 변경은 커밋하지 않는다(되돌린다). 버그 발견 시 5단계 프로토콜(TEST_METHODOLOGY §2).

## 관련
- `tools/simKovo.ts` — 리그 팀 절대 KOVO 분포(세트당 환산·목표 범위 ✓/⚠). 절대 캘리브레이션은 여기로.
- `tools/simEngineRegression.ts` — 본 하네스(상대 A/B). 메모리: [[no-guessing-run-stats]]·[[stats-protocol]]·[[engine-review-loop]].

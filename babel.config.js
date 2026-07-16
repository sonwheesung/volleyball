module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      // 릴리즈(production) 번들에서만 console.log/info/debug 제거 — error·warn은 남겨 런타임 문제 신호 보존.
      // 정보 노출(내부 상태·토큰 흔적·시드 로그)을 프로덕션 로그캣에서 차단(OWASP MASVS-STORAGE/보안 감사 2026-07-16).
      // dev/test 번들은 무영향(env.production 하위라 __DEV__ 로깅 그대로).
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  };
};

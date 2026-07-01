// Side-effect import: installs an in-memory AsyncStorage mock so the real zustand
// persist store can be driven in Node. Import this BEFORE importing the store.
import Module from 'module';

const mem = new Map<string, string>();
const impl = {
  getItem: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: async (k: string, v: string) => { mem.set(k, v); },
  removeItem: async (k: string) => { mem.delete(k); },
};
const mock: any = { ...impl, default: impl };
mock.default.default = impl;

// react-native 스텁 — store/persistStorage 가 AppState 를 top-level import 하면서(A6 디바운스 영속, 2026-07-01)
// Node 검증 경로가 진짜 react-native(flow 문법 index.js)를 끌어와 esbuild transform 이 깨졌다. AsyncStorage 와
// 같은 패턴으로 'react-native' 도 가로채 noop 스텁을 돌려준다. 정의 안 한 export(View·Platform 등)는 Proxy 가
// noop 함수로 메워 향후 새 RN import 가 끼어도 배터리가 안 깨진다(평가만 되고 실제 호출 없음).
const rnBase: any = {
  AppState: { addEventListener: () => ({ remove() {} }), removeEventListener: () => {}, currentState: 'active' },
  Platform: { OS: 'android', select: (o: any) => (o && (o.android ?? o.default)) },
};
const rnMock: any = new Proxy(rnBase, {
  get(target, prop) {
    if (prop === 'default') return rnMock;
    if (prop in target) return target[prop];
    if (typeof prop === 'symbol') return undefined;
    return () => undefined; // 미정의 RN export → noop
  },
});

const origReq = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === '@react-native-async-storage/async-storage') return mock;
  if (id === 'react-native') return rnMock;
  return origReq.apply(this, arguments as any);
};

export const __asyncStorageMem = mem;

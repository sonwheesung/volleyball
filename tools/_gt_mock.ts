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

const origReq = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === '@react-native-async-storage/async-storage') return mock;
  return origReq.apply(this, arguments as any);
};

export const __asyncStorageMem = mem;

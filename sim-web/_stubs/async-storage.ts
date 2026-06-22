// 헤드리스/브라우저용 in-memory AsyncStorage 스텁(엔진 콘솔은 세이브를 안 쓴다).
const store = new Map<string, string>();
export default {
  getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
  getAllKeys: async () => [...store.keys()],
  multiRemove: async (ks: string[]) => { ks.forEach((k) => store.delete(k)); },
  multiGet: async (ks: string[]) => ks.map((k) => [k, store.get(k) ?? null]),
  clear: async () => { store.clear(); },
};

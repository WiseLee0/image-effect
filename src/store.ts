import { create } from "zustand";

export const useStore = create((set) => ({
  count: 0,
  update: () => set((state: any) => ({ count: state.count + 1 })),
}));

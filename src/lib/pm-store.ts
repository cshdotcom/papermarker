import { create } from 'zustand'
import type { TaskDetail } from './pm'

export type View = 'dashboard' | 'review' | 'settings' | 'scan'

interface Layers {
  boxes: boolean
  marks: boolean
  scores: boolean
  answers: boolean
}

interface PmState {
  view: View
  currentTaskId: string | null
  authed: boolean
  authLoading: boolean
  username: string
  layers: Layers
  taskDetail: TaskDetail | null
  selectedAnnotationId: string | null
  setView: (v: View) => void
  openTask: (id: string) => void
  setAuthed: (b: boolean) => void
  setAuthLoading: (b: boolean) => void
  setUsername: (u: string) => void
  logout: () => void
  setTaskDetail: (t: TaskDetail | null) => void
  toggleLayer: (k: keyof Layers) => void
  setSelected: (id: string | null) => void
}

export const usePm = create<PmState>((set) => ({
  view: 'dashboard',
  currentTaskId: null,
  authed: false,
  authLoading: true,
  username: '',
  layers: { boxes: true, marks: true, scores: true, answers: false },
  taskDetail: null,
  selectedAnnotationId: null,
  setView: (v) => set({ view: v }),
  openTask: (id) => set({ view: 'review', currentTaskId: id, selectedAnnotationId: null }),
  setAuthed: (b) => set({ authed: b }),
  setAuthLoading: (b) => set({ authLoading: b }),
  setUsername: (u) => set({ username: u }),
  logout: () =>
    set({
      authed: false,
      username: '',
      view: 'dashboard',
      currentTaskId: null,
      taskDetail: null,
    }),
  setTaskDetail: (t) => set({ taskDetail: t }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setSelected: (id) => set({ selectedAnnotationId: id }),
}))

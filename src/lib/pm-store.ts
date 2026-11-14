import { create } from 'zustand'
import type { TaskDetail, MarkLayers } from './pm'
import { DEFAULT_MARK_LAYERS } from './pm'

export type View = 'dashboard' | 'review' | 'settings' | 'scan'

export type Layers = MarkLayers

interface PmState {
  view: View
  currentTaskId: string | null
  authed: boolean
  authLoading: boolean
  username: string
  layers: Layers
  taskDetail: TaskDetail | null
  selectedAnnotationId: string | null
  /** 待剪辑照片队列（拍照/选图后先进入四角剪辑器） */
  pendingScanFiles: File[]
  setView: (v: View) => void
  openTask: (id: string) => void
  setAuthed: (b: boolean) => void
  setAuthLoading: (b: boolean) => void
  setUsername: (u: string) => void
  logout: () => void
  setTaskDetail: (t: TaskDetail | null) => void
  toggleLayer: (k: keyof Layers) => void
  setLayers: (l: Partial<Layers>) => void
  setSelected: (id: string | null) => void
  pushPendingScanFiles: (files: File[]) => void
  consumePendingScanFiles: () => File[]
}

export const usePm = create<PmState>((set, get) => ({
  view: 'dashboard',
  currentTaskId: null,
  authed: false,
  authLoading: false,
  username: '',
  layers: { ...DEFAULT_MARK_LAYERS },
  taskDetail: null,
  selectedAnnotationId: null,
  pendingScanFiles: [],
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
      pendingScanFiles: [],
    }),
  setTaskDetail: (t) => set({ taskDetail: t }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setLayers: (l) => set((s) => ({ layers: { ...s.layers, ...l } })),
  setSelected: (id) => set({ selectedAnnotationId: id }),
  pushPendingScanFiles: (files) =>
    set((s) => ({ pendingScanFiles: [...s.pendingScanFiles, ...files] })),
  consumePendingScanFiles: () => {
    const files = get().pendingScanFiles
    set({ pendingScanFiles: [] })
    return files
  },
}))

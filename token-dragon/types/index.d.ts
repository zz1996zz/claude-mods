export type Window = { percent: number; resetsAt: string | null }
export type Snapshot = { five: Window | null; seven: Window | null }

declare module 'claude-code' {
  interface PluginState {
    'token-dragon': { snapshot: Snapshot | null; frame: number }
  }
}

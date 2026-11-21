export type NotifyMessage =
  | string
  | {
      title?: string
      body: string
    }

export interface NotifyChannel {
  readonly name: string
  send(text: string): Promise<void>
}

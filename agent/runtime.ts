export type Channel = "repl" | "discord";
export type SendFn = (text: string) => Promise<void>;

export type ProcessTurn = (
  sessionId: string,
  channel: Channel,
  userInput: string,
  send: SendFn
) => Promise<void>;

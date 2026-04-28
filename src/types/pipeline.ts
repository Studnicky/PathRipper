export type NextFnType = () => Promise<void>;
export type TaskFnType<TState> = (next: NextFnType, state: TState) => Promise<void>;

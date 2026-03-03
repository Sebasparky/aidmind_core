export class StateGateError extends Error {
  public statusCode: number;
  public currentState: string;
  public allowedState: string;

  constructor(currentState: string, allowedState: string) {
    super(`State mismatch: current="${currentState}", allowed="${allowedState}"`);
    this.name = 'StateGateError';
    this.statusCode = 409;
    this.currentState = currentState;
    this.allowedState = allowedState;
  }
}

export function assertStateOrThrow(
  session: { state: string } | null,
  allowedState: string
): void {
  if (!session) {
    const err = new Error('Session not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (session.state !== allowedState) {
    throw new StateGateError(session.state, allowedState);
  }
}

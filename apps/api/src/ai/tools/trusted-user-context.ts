/** Contexts issued by the server; a structurally identical object built elsewhere is not trusted. */
const issued = new WeakSet<TrustedUserContext>();

/**
 * Proof that FinVoice itself established which user an agent acts for, for example from an
 * authenticated session (a later step). User-context tools only accept this, never a user id.
 *
 * NEVER create one from request input: a request body, a query or path parameter, a chat message,
 * a tool argument or a voice protocol message. No request path creates one yet (the agent and
 * voice are not personalised), so no public agent or browser can reach personal data. A future
 * authenticated agent will create it only from the verified access token (@CurrentUser()).
 */
export class TrustedUserContext {
  private constructor(readonly userId: string) {
    Object.freeze(this);
  }

  /** For the (future) authentication layer, after it has verified who the user is. */
  static fromAuthenticatedUser(userId: string): TrustedUserContext {
    const context = new TrustedUserContext(userId);
    issued.add(context);
    return context;
  }

  static isTrusted(value: unknown): value is TrustedUserContext {
    return value instanceof TrustedUserContext && issued.has(value);
  }
}

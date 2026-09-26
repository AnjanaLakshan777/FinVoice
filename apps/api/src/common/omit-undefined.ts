export type WithoutUndefined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops keys whose value is `undefined`, so a partial update only touches the fields the client
 * sent. `null` is kept: it deliberately clears a nullable field.
 */
export function omitUndefined<T extends Record<string, unknown>>(value: T): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as WithoutUndefined<T>;
}

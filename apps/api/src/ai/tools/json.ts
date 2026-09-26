import type { JsonObject, JsonValue } from "../model/language-model.js";

/**
 * Returns a deep copy of `value` that contains only JSON data (plain objects, arrays, strings,
 * finite numbers, booleans, null), or throws. Guards everything sent to the model: Prisma
 * records, Decimal instances, Dates, Errors or class instances can never slip into a payload.
 */
export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value, "$");
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("Tool result must be a JSON object");
  }
  return json;
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${String(index)}]`));
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) {
        result[key] = toJsonValue(item, `${path}.${key}`);
      }
    }
    return result;
  }
  throw new TypeError(`Value at ${path} is not plain JSON data`);
}

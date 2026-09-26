/**
 * Calendar dates (PostgreSQL DATE) are exchanged as "YYYY-MM-DD" strings. Prisma represents a
 * DATE as a JS Date at UTC midnight, so conversions use UTC only, never the server's local time
 * zone, which could shift a date to the neighbouring day.
 */
export function calendarDateToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateToCalendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// The time that two-step verification reads, in one place (ASVS V6.5.8).
//
// A one-time code is only meaningful against a clock, and that clock is THIS
// SERVER's: nothing a client sends (no field, no header) is ever used as the time.
// The function is replaceable so that a test can move the clock instead of waiting
// 30 seconds for the next code; nothing else in the application reads it.
export const clock = {
  now: (): number => Date.now()
};

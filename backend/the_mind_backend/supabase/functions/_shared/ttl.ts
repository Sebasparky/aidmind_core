export function computeTtl(minutes: number): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + minutes);
  return now.toISOString();
}

export function computeTtlHours(hours: number): string {
  const now = new Date();
  now.setHours(now.getHours() + hours);
  return now.toISOString();
}

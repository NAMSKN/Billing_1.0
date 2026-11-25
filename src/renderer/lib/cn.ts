/** Tiny className combiner — filters falsy values and joins with spaces. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

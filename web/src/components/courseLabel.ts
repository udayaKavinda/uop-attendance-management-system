/**
 * How a course's batches read wherever the course is named: "E21, E22, E23".
 *
 * One course carries every batch that takes it, so this is a list, and every
 * screen joins it the same way rather than each deciding its own separator.
 */
export function batchesLabel(batches: readonly string[] | undefined): string {
  return (batches ?? []).join(', ');
}

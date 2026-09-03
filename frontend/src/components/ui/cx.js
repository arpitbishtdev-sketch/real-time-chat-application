// Tiny local classname-joiner — not worth a dependency (clsx) for this
// project's scale, per the instruction against adding unnecessary deps.
export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

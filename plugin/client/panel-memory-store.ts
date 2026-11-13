type Cell<T> = { value: T; listeners: Set<() => void> };
const hosts = new WeakMap<object, Map<string, Cell<unknown>>>();

/** UI memory lives with the host's plugin cache, rather than a workspace panel. */
export function panelMemory<T>(host: object, key: string, initial: T) {
  let cells = hosts.get(host);
  if (!cells) hosts.set(host, cells = new Map());
  let cell = cells.get(key) as Cell<T> | undefined;
  if (!cell) {
    cell = { value: initial, listeners: new Set() };
    cells.set(key, cell as Cell<unknown>);
  }
  const current = cell;
  return {
    get: () => current.value,
    set: (update: T | ((previous: T) => T)) => {
      const next = typeof update === "function" ? (update as (previous: T) => T)(current.value) : update;
      if (Object.is(next, current.value)) return;
      current.value = next;
      current.listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      current.listeners.add(listener);
      return () => { current.listeners.delete(listener); };
    },
  };
}

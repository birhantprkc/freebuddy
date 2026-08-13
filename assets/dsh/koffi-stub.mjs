/**
 * Fail-closed JavaScript stand-in for `koffi`.
 *
 * Official DeepSeek JSONL / Windows ACL call `koffi.load("kernel32.dll")`
 * and then stdcall Win32 APIs. Loading that native addon from an Electron
 * child on Windows aborts with STATUS_ACCESS_VIOLATION (0xC0000005).
 * Returning 0 makes those callers throw a JS error instead of crashing.
 */

function failClosed() {
  return 0;
}

function func() {
  return failClosed;
}

function load() {
  return {
    func,
    cdecl: func,
    stdcall: func,
    pointer() {
      return {};
    },
    alloc() {
      return {};
    },
    decode() {
      return null;
    },
    address() {
      return 0n;
    }
  };
}

const api = {
  load,
  func,
  pointer() {
    return {};
  },
  alloc() {
    return {};
  },
  decode() {
    return null;
  },
  address() {
    return 0n;
  },
  types: {},
  proto: func,
  register: func
};

export default api;
export { load, func };

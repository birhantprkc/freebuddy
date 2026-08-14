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

// `dsh-sandbox-windows-acl` builds its FFI type table at module import
// (top-level `koffi.struct(...)`/`koffi.pointer(...)`), so the stub must
// expose every API referenced there or the import throws before the
// package's platform guard can skip the Win32 calls on non-Windows.
function struct() {
  return {};
}

function encode() {
  return undefined;
}

function load() {
  return {
    func,
    cdecl: func,
    stdcall: func,
    pointer() {
      return {};
    },
    struct,
    alloc() {
      return {};
    },
    encode,
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
  struct,
  alloc() {
    return {};
  },
  encode,
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

const stubUrl = new URL("./koffi-stub.mjs", import.meta.url).href;

function isKoffiSpecifier(specifier, context) {
  if (
    specifier === "koffi" ||
    specifier.startsWith("koffi/") ||
    specifier.startsWith("koffi\\")
  ) {
    return true;
  }
  let href = specifier;
  try {
    href = new URL(specifier, context.parentURL).href;
  } catch {
    href = specifier;
  }
  return /(?:^|[/\\])node_modules[/\\]koffi(?:[/\\]|$)/i.test(href);
}

export async function resolve(specifier, context, nextResolve) {
  if (isKoffiSpecifier(specifier, context)) {
    return { url: stubUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

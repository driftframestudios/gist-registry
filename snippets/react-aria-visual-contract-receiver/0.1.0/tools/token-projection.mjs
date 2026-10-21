function declarationMap(entries, label) {
  const map = new Map();
  for (const entry of entries) {
    if (map.has(entry.name)) throw new Error(`${label} repeats ${entry.name}`);
    map.set(entry.name, entry.value);
  }
  return map;
}

export function parseCustomProperties(css) {
  const root = /:root\s*\{(?<body>[\s\S]*?)\}/u.exec(css);
  if (!root?.groups?.body) throw new Error("token CSS must contain one :root block");
  const entries = [];
  for (const match of root.groups.body.matchAll(/^\s*(?<name>--[a-z0-9-]+)\s*:\s*(?<value>[^;]+);\s*$/gimu)) {
    entries.push({name: match.groups.name, value: match.groups.value.trim()});
  }
  declarationMap(entries, "token CSS");
  return entries;
}

export function projectCustomProperties(css, adapter) {
  if (adapter?.kind !== "bounded_custom_property_projection") {
    throw new Error("unsupported token projection kind");
  }
  const source = declarationMap(parseCustomProperties(css), "source artifact");
  const targetNames = new Set();
  return adapter.selection.map((sourceName) => {
    if (!source.has(sourceName)) throw new Error(`source artifact is missing ${sourceName}`);
    const targetName = adapter.renames[sourceName] ?? sourceName;
    if (targetNames.has(targetName)) throw new Error(`projection repeats ${targetName}`);
    targetNames.add(targetName);

    const normalization = adapter.valueNormalizations[sourceName];
    const sourceValue = source.get(sourceName);
    if (normalization && sourceValue !== normalization.from) {
      throw new Error(
        `${sourceName} expected ${normalization.from} before ${normalization.rule}; received ${sourceValue}`
      );
    }
    return {
      name: targetName,
      value: normalization?.to ?? sourceValue
    };
  });
}

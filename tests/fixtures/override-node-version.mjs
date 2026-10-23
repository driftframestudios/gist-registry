const version = process.env.NODE_RUNTIME_TEST_VERSION;
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version ?? "")) {
  throw new Error("NODE_RUNTIME_TEST_VERSION must carry a complete synthetic Node coordinate.");
}

Object.defineProperty(process, "version", {
  ...Object.getOwnPropertyDescriptor(process, "version"),
  value: version,
});
Object.defineProperty(process.versions, "node", {
  ...Object.getOwnPropertyDescriptor(process.versions, "node"),
  value: version.slice(1),
});

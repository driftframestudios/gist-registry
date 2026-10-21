import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { clonePlainData, ObserverError } from "./contracts.mjs";

const schema = JSON.parse(await readFile(new URL("../schema/receipt.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function validateReceiptSchema(inputReceipt) {
  const receipt = clonePlainData(inputReceipt, { boundary: "receipt", restartFrom: "receipt" });
  if (validate(receipt)) return receipt;
  throw new ObserverError("RECEIPT_SCHEMA_REJECTED", "Receipt fields must satisfy the versioned observation schema.", {
    errors: validate.errors.map(error => ({ instancePath: error.instancePath, keyword: error.keyword, message: error.message })),
    restartFrom: "receipt",
  });
}

import { extractBankFieldsFromText } from "../src/utils/ocrMatcherEngine";
const text = "Given Name: JOHN\nFamily Name: DOE\nDOB: 14/08/1988\nBSB: 062-000";
const results = extractBankFieldsFromText(text);
for (const r of results) {
  if (r.status === "matched") {
    console.log(r.fieldId, "|", r.fieldName, "|", JSON.stringify(r.extractedValue), "|", JSON.stringify(r.canonicalValue));
  }
}

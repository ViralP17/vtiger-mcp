import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDescribe, prepareElement } from "../dist/core/schema.js";

// A fake `describe` result standing in for a customized module.
const describe = {
  name: "Leads",
  label: "Leads",
  createable: true,
  updateable: true,
  deleteable: true,
  fields: [
    { name: "lastname", label: "Last Name", mandatory: true, type: { name: "string" } },
    { name: "account_id", label: "Account", mandatory: true, type: { name: "reference", refersTo: ["Accounts"] } },
    { name: "leadsource", label: "Lead Source", mandatory: false, type: { name: "picklist", picklistValues: [{ label: "Web", value: "Web" }, { label: "Cold Call", value: "Cold Call" }] } },
    { name: "email", label: "Email", mandatory: false, type: { name: "email" } },
  ],
};

test("normalizeDescribe distills fields, picklists and references", () => {
  const s = normalizeDescribe(describe);
  assert.equal(s.createable, true);
  assert.deepEqual(s.byName.get("leadsource").picklist, ["Web", "Cold Call"]);
  assert.deepEqual(s.byName.get("account_id").refersTo, ["Accounts"]);
  assert.equal(s.byName.get("lastname").mandatory, true);
});

test("create: missing mandatory fields are reported with type/reference", () => {
  const s = normalizeDescribe(describe);
  const { issues } = prepareElement(s, { leadsource: "Web" }, { forCreate: true });
  assert.ok(issues.some((i) => i.includes("'lastname'") && i.includes("required")));
  assert.ok(issues.some((i) => i.includes("'account_id'") && i.includes("Accounts")));
});

test("create: complete payload passes", () => {
  const s = normalizeDescribe(describe);
  const { issues } = prepareElement(s, { lastname: "X", account_id: "11x1" }, { forCreate: true });
  assert.deepEqual(issues, []);
});

test("picklist: case-only mismatch is normalised, not rejected", () => {
  const s = normalizeDescribe(describe);
  const { values, issues } = prepareElement(s, { lastname: "X", account_id: "11x1", leadsource: "web" }, { forCreate: true });
  assert.deepEqual(issues, []);
  assert.equal(values.leadsource, "Web");
});

test("picklist: invalid value lists the allowed options", () => {
  const s = normalizeDescribe(describe);
  const { issues } = prepareElement(s, { lastname: "X", account_id: "11x1", leadsource: "Nope" }, { forCreate: true });
  assert.ok(issues.some((i) => i.includes("must be one of: Web, Cold Call")));
});

test("unknown field names are caught", () => {
  const s = normalizeDescribe(describe);
  const { issues } = prepareElement(s, { lastname: "X", account_id: "11x1", notafield: 1 }, { forCreate: true });
  assert.ok(issues.some((i) => i.includes("'notafield'") && i.includes("not a field")));
});

test("update: mandatory fields are NOT required (partial)", () => {
  const s = normalizeDescribe(describe);
  const { issues } = prepareElement(s, { leadsource: "Web" }, { forCreate: false });
  assert.deepEqual(issues, []);
});

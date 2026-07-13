/**
 * vtiger identifies records with a composite "webservice id" of the form
 * `<moduleEntityId>x<recordId>`, e.g. "17x1234". These helpers make it
 * safe to detect and work with that format.
 */

const WS_ID_RE = /^\d+x\d+$/;

/** True if `value` looks like a vtiger webservice id (e.g. "17x1234"). */
export function isWebserviceId(value: string): boolean {
  return WS_ID_RE.test(value.trim());
}

/** Split a webservice id into its module and record parts. */
export function splitId(id: string): { moduleId: string; recordId: string } {
  if (!isWebserviceId(id)) {
    throw new Error(`Not a valid vtiger webservice id: "${id}" (expected "<num>x<num>")`);
  }
  const [moduleId, recordId] = id.split("x");
  return { moduleId, recordId };
}

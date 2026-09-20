/**
 * Rejects extracted "values" that are really the form's own label or instruction text.
 *
 * Found by reading all 44 identities the pipeline produced: ~47% of populated field values were label or
 * instruction text lifted from blank forms ("(in full)" as a given name, "or Medicare card." as a licence,
 * "to request your tax file number (TFN)..." as a residential address, "Are you an Australian Resident?" as a
 * date of birth). Those fabricated fake people. This module is the guard between extraction and storage.
 */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Words that make up form labels. A value made (almost) only of these is a label, not data. */
const LABEL_WORDS = new Set(
  (
    'given name names first last family surname middle other date of birth dob number phone mobile home work business ' +
    'address residential postal mailing email title suffix initials in full yes no male female mr mrs miss ms dr prof ' +
    'country occupation signature day month year dd mm yyyy preferred previous former tax file tfn contact and or the a ' +
    'employer employee started working for you gender sex marital status suburb state postcode town locality street ' +
    'unit apartment licence license passport medicare card expiry issue place age relationship ' +
    'withheld income amount total gross net description payer code type rate balance limit franked unfranked credit'
  ).split(' '),
);

/** Words that only appear in sentences addressed to the person filling the form. */
const INSTRUCTION_MARKERS = new Set([
  'you', 'your', 'we', 'our', 'please', 'must', 'should', 'will', 'may', 'if', 'provide', 'attach', 'complete',
  'applicant', 'applicants', 'form', 'section', 'instructions', 'must', 'required', 'refer', 'tick', 'enter', 'write',
]);

const STOP = new Set(['the', 'you', 'your', 'must', 'provide', 'if', 'or', 'of', 'to', 'and', 'is', 'are', 'will', 'with', 'for', 'that', 'this', 'may', 'be', 'by', 'in', 'on', 'as', 'at', 'an', 'a', 'we', 'our', 'not', 'from', 'have', 'has', 'which', 'should', 'please']);

const PURE_LABELS = new Set(['number', 'address', 'name', 'email', 'phone', 'mobile', 'date', 'title', 'suffix', 'country', 'details', 'signature']);

export type Rejection =
  | 'label-text' | 'instruction-text' | 'question' | 'not-a-name' | 'not-a-date'
  | 'not-an-email' | 'not-a-mobile' | 'not-an-address' | 'not-an-id';

const ADDRESS_FIELDS = new Set(['residential_address', 'postal_address', 'previous_address']);
const STREET_WORD = /\b(street|st|road|rd|avenue|ave|av|drive|dr|court|ct|place|pl|lane|ln|crescent|cres|highway|hwy|parade|pde|boulevard|blvd|terrace|tce|way|close|circuit|cct|square|sq|esplanade|esp|grove|rise|row|walk|track|trail|mews|view|ridge|glen|loop|path|po box|gpo box|locked bag|unit|lot|apartment|apt|level)\b/i;

/**
 * Shape checks for fields whose values have a known form. A value that is the wrong shape is form text or an OCR
 * fragment; leaving the field empty (the reviewer can fill it) is safer than storing something that looks real.
 */
function typedFieldRejection(fieldId: string, raw: string): Rejection | null {
  if (fieldId === 'email_address') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? null : 'not-an-email';
  if (fieldId === 'mobile_number') {
    const digits = raw.replace(/\D/g, '');
    // 04xx xxx xxx, or +61 4xx xxx xxx. Excludes 13/1300/1800 business lines and landlines.
    return /^(?:04\d{8}|614\d{8})$/.test(digits) && !/[a-z]{3,}/i.test(raw) ? null : 'not-a-mobile';
  }
  if (ADDRESS_FIELDS.has(fieldId)) {
    return /\d/.test(raw) && STREET_WORD.test(raw) && !/[|]/.test(raw) && raw.length >= 8 ? null : 'not-an-address';
  }
  if (fieldId === 'drivers_licence' || fieldId === 'passport_details') {
    const alphaWords = raw.split(/\s+/).filter(w => /[a-z]{3,}/i.test(w)).length;
    return /\d/.test(raw) && alphaWords <= 2 && raw.length <= 24 ? null : 'not-an-id';
  }
  return null;
}

const NAME_FIELDS = new Set(['given_names', 'family_name', 'middle_name', 'preferred_name', 'previous_name']);

/** Strip label words from both ends: "or family name Reddy" -> "Reddy", "Tyler Name:" -> "Tyler". */
export function stripLabelWords(value: string): string {
  const words = value.trim().split(/\s+/);
  const isLabel = (w: string) => LABEL_WORDS.has(norm(w)) || norm(w) === '';
  let a = 0;
  let b = words.length;
  while (a < b && isLabel(words[a])) a++;
  while (b > a && isLabel(words[b - 1])) b--;
  return words.slice(a, b).join(' ').trim();
}

/**
 * @param fieldId   the field the value was captured for
 * @param value     the captured value
 * @param ownLabels the field's own label vocabulary (exampleLabels), e.g. ["Given Names", "First Name"]
 * @returns null when the value looks like real data; otherwise why it was rejected
 */
export function rejectReason(fieldId: string, value: string, ownLabels: string[] = []): Rejection | null {
  const raw = value.trim();
  const n = norm(raw);
  if (!n) return 'label-text'; // punctuation only (",", "-") or nothing left: there is no content
  const words = n.split(' ');

  if (fieldId === 'date_of_birth') {
    const dateish = /\d{1,2}\s*[\/\-. ]\s*\d{1,2}\s*[\/\-. ]\s*\d{2,4}|\d{1,2}\s*[a-z]{3,9}\s*\d{2,4}|[a-z]{3,9}\s+\d{1,2},?\s+\d{4}/i;
    return dateish.test(raw) && raw.length <= 24 ? null : 'not-a-date';
  }

  if (raw.endsWith('?')) return 'question';

  // Name fields: judged on their cleaned form, and single tokens like "01/JINGYI" must still be checked.
  if (NAME_FIELDS.has(fieldId)) {
    const cleaned = stripLabelWords(raw);
    if (!cleaned) return 'label-text';
    if (cleaned.split(/\s+/).length > 4 || /\d/.test(cleaned) || /[()\/\\@#]/.test(cleaned)) return 'not-a-name';
    return null;
  }

  const typed = typedFieldRejection(fieldId, raw);
  if (typed) return typed;

  // One token (an email, "Mr", "Married", "Full-time", a number) can't be an instruction sentence; only bare
  // pure-label words are rejected.
  if (!/\s/.test(raw)) return PURE_LABELS.has(n) ? 'label-text' : null;
  if (words.length >= 2 && ownLabels.some(l => norm(l) === n)) return 'label-text';

  const labelish = words.filter(w => LABEL_WORDS.has(w)).length;
  if (words.length <= 10 && labelish / words.length >= 0.8) return 'label-text';

  const markers = words.filter(w => INSTRUCTION_MARKERS.has(w)).length;
  const stops = words.filter(w => STOP.has(w)).length;
  if (words.length >= 4 && markers >= 1) return 'instruction-text';
  if (words.length >= 6 && stops / words.length >= 0.3) return 'instruction-text';
  if (words.length >= 4 && /^[a-z]/.test(raw)) return 'instruction-text';
  return null;
}

/** For name fields: the value with leading/trailing label words removed ("or family name Reddy" -> "Reddy"). */
export function cleanNameValue(fieldId: string, value: string): string {
  return NAME_FIELDS.has(fieldId) ? stripLabelWords(value) : value;
}

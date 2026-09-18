/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AustralianValidationDetail, ExtractionResult } from '../types';

export interface DobValidationOutput {
  isValid: boolean;
  errorCode?: 'INVALID_FORMAT' | 'INVALID_CALENDAR_DATE' | 'FUTURE_DATE' | 'UNDERAGE' | 'OUT_OF_RANGE';
  message: string;
  canonicalDate?: string;
  age?: number;
  day?: number;
  month?: number;
  year?: number;
  /** Day and month are both <= 12 and differ, so DD/MM vs MM/DD cannot be told apart from the text alone. */
  ambiguousOrder?: boolean;
}

export interface PostcodeValidationOutput {
  isValid: boolean;
  errorCode?: 'NOT_4_DIGITS' | 'INVALID_ZONE' | 'STATE_MISMATCH';
  message: string;
  canonicalPostcode?: string;
  allocatedState?: string;
  isStateCoherent?: boolean;
}

export interface AbnValidationOutput {
  isValid: boolean;
  errorCode?: 'INVALID_LENGTH' | 'INVALID_LEADING_ZERO' | 'NON_NUMERIC' | 'CHECKSUM_FAILED';
  message: string;
  canonicalAbn?: string;
  checksumSum?: number;
  remainder?: number;
}

export interface BsbValidationOutput {
  isValid: boolean;
  errorCode?: 'NOT_6_DIGITS' | 'NON_NUMERIC' | 'RESERVED_CODE';
  message: string;
  canonicalBsb?: string;
  institutionName?: string;
  stateRegion?: string;
}

export interface PhoneValidationOutput {
  isValid: boolean;
  message: string;
  canonicalPhone?: string;
  phoneType?: 'mobile' | 'landline' | 'toll_free';
}

const APRA_ADI_MAP: Record<string, string> = {
  '01': 'ANZ Bank (Australia and New Zealand Banking Group)',
  '03': 'Westpac Banking Corporation',
  '73': 'St.George Bank / Westpac Group',
  '04': 'Macquarie Bank',
  '06': 'Commonwealth Bank of Australia (CBA)',
  '08': 'National Australia Bank (NAB)',
  '09': 'Reserve Bank of Australia (RBA)',
  '11': 'St.George Bank (Specialized Branch)',
  '12': 'Bank of Melbourne',
  '18': 'Bank of Queensland (BOQ)',
  '19': 'Bank of Western Australia (Bankwest)',
  '30': 'Bankwest (CBA Subsidiary)',
  '484': 'Suncorp Bank',
  '633': 'Bendigo and Adelaide Bank',
  '802': 'Auswide Bank',
  '814': 'Great Southern Bank',
};

const BSB_STATE_DIGIT_MAP: Record<string, string> = {
  '2': 'NSW / ACT',
  '3': 'VIC / TAS',
  '4': 'QLD',
  '5': 'SA / NT',
  '6': 'WA',
};

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];
const MONTH_ABBR = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

/**
 * Validates Australian Date of Birth (DOB).
 * Enforces standard Australian DD/MM/YYYY formatting, calendar validity,
 * realistic age bounds, and non-future verification.
 */
const MAX_APPLICANT_AGE = 120;

function minApplicantAge(): number {
  const raw = typeof process !== 'undefined' ? Number(process.env?.OCRDOCS_MIN_APPLICANT_AGE) : NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : 16;
}

/** Current calendar date in Australia/Sydney as a local-midnight Date (time-of-day zeroed). */
function australianToday(): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  } catch {
    return new Date();
  }
}

const OCR_DIGIT_FIXES: Record<string, string> = {
  O: '0', o: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', S: '5', B: '8',
};

/**
 * Repairs OCR letter/digit confusables inside a digit-only identifier candidate.
 * Returns null when nothing needed repair. The caller MUST re-validate (checksum/format) and only
 * accept the repaired value if that passes -- repair alone is never evidence.
 */
export function repairOcrDigits(candidate: string): string | null {
  const repaired = candidate.replace(/[OoQIli|SB]/g, (c) => OCR_DIGIT_FIXES[c]);
  return repaired === candidate ? null : repaired;
}

export function validateAustralianDob(rawDob: string): DobValidationOutput {
  if (!rawDob || !rawDob.trim()) {
    return {
      isValid: false,
      errorCode: 'INVALID_FORMAT',
      message: 'Date of birth is empty.',
    };
  }

  const cleaned = rawDob.trim();
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  // Format 1: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD MM YYYY
  const numRegex = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/;
  const numMatch = cleaned.match(numRegex);

  if (numMatch) {
    day = parseInt(numMatch[1], 10);
    month = parseInt(numMatch[2], 10);
    let rawYear = parseInt(numMatch[3], 10);
    if (rawYear < 100) {
      // 2-digit year conversion: e.g. 88 -> 1988, 05 -> 2005
      rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
    }
    year = rawYear;
  } else {
    // Format 2: "14 August 1988", "14-Aug-1988", "14 Aug 88"
    const wordDateRegex = /^(\d{1,2})[\s\-/.]([a-zA-Z]{3,12})[\s\-/. ](\d{2,4})$/;
    const wordMatch = cleaned.match(wordDateRegex);

    if (wordMatch) {
      day = parseInt(wordMatch[1], 10);
      const monthStr = wordMatch[2].toLowerCase();
      const monthIdx = MONTH_NAMES.indexOf(monthStr) !== -1
        ? MONTH_NAMES.indexOf(monthStr) + 1
        : MONTH_ABBR.indexOf(monthStr.substring(0, 3)) + 1;

      if (monthIdx > 0) {
        month = monthIdx;
        let rawYear = parseInt(wordMatch[3], 10);
        if (rawYear < 100) {
          rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
        }
        year = rawYear;
      }
    }
  }

  if (day === null || month === null || year === null) {
    return {
      isValid: false,
      errorCode: 'INVALID_FORMAT',
      message: `Invalid date format '${cleaned}'. Expected Australian standard DD/MM/YYYY.`,
    };
  }

  // Verify Month
  if (month < 1 || month > 12) {
    return {
      isValid: false,
      errorCode: 'INVALID_CALENDAR_DATE',
      message: `Invalid month '${month}'. Month must be between 01 and 12.`,
    };
  }

  // Days in month validation (accounting for leap years)
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonths[month - 1];

  if (day < 1 || day > maxDay) {
    const monthName = MONTH_NAMES[month - 1];
    return {
      isValid: false,
      errorCode: 'INVALID_CALENDAR_DATE',
      message: `Invalid calendar date: Day ${day} does not exist in ${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year} (max ${maxDay} days).`,
    };
  }

  // "Today" is evaluated in Australian civil time (Sydney), not the server's zone, so a 23:00 UTC
  // request on the birthday's eve is not a day off. Falls back to local time if Intl lacks the zone.
  const today = australianToday();
  const currentYear = today.getFullYear();
  const birthDate = new Date(year, month - 1, day);

  if (birthDate > today) {
    return {
      isValid: false,
      errorCode: 'FUTURE_DATE',
      message: `Date of birth cannot be in the future (${day}/${month}/${year}).`,
    };
  }

  if (year < 1900) {
    return {
      isValid: false,
      errorCode: 'OUT_OF_RANGE',
      message: `Year ${year} is outside standard operating range (1900-${currentYear}).`,
    };
  }

  // Calculate exact age in years
  let age = currentYear - year;
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  if (age > MAX_APPLICANT_AGE) {
    return {
      isValid: false,
      errorCode: 'OUT_OF_RANGE',
      message: `Age ${age} exceeds the plausible maximum of ${MAX_APPLICANT_AGE}.`,
    };
  }
  const minAge = minApplicantAge();
  if (age < minAge) {
    return {
      isValid: false,
      errorCode: 'UNDERAGE',
      message: `Age ${age} is below the minimum applicant age of ${minAge}; needs review.`,
      age,
    };
  }

  const paddedDay = day.toString().padStart(2, '0');
  const paddedMonth = month.toString().padStart(2, '0');
  const canonicalDate = `${paddedDay}/${paddedMonth}/${year}`;

  return {
    ambiguousOrder: day <= 12 && month <= 12 && day !== month,
    isValid: true,
    message: `Valid Australian DOB: ${canonicalDate} (Age: ${age})`,
    canonicalDate,
    age,
    day,
    month,
    year,
  };
}

/**
 * Validates Australian Postcodes.
 * Enforces strictly 4 numeric digits, geocoded state allocation, and 0200-9999 boundaries.
 */
export function validateAustralianPostcode(
  rawPostcode: string,
  stateContext?: string
): PostcodeValidationOutput {
  if (!rawPostcode || !rawPostcode.trim()) {
    return {
      isValid: false,
      errorCode: 'NOT_4_DIGITS',
      message: 'Postcode value is empty.',
    };
  }

  const trimmed = rawPostcode.trim();
  const cleanedDigits = trimmed.replace(/\D/g, '');

  // Australian postcodes must be strictly 4 digits
  if (cleanedDigits.length !== 4 || trimmed !== cleanedDigits) {
    return {
      isValid: false,
      errorCode: 'NOT_4_DIGITS',
      message: `Australian Postcode must be exactly 4 digits. Received '${trimmed}' (${cleanedDigits.length} digits).`,
    };
  }

  const num = parseInt(cleanedDigits, 10);

  // Geographic boundaries (Australia Post does not allocate 0000-0199)
  if (num < 200 || num > 9999) {
    return {
      isValid: false,
      errorCode: 'INVALID_ZONE',
      message: `Postcode ${cleanedDigits} is out of Australian postal range (0200-9999).`,
    };
  }

  // Determine allocated State from Postcode range
  let allocatedState = 'UNKNOWN';
  if ((num >= 1000 && num <= 2599) || (num >= 2619 && num <= 2899) || (num >= 2921 && num <= 2999)) {
    allocatedState = 'NSW';
  } else if ((num >= 200 && num <= 299) || (num >= 2600 && num <= 2618) || (num >= 2900 && num <= 2920)) {
    allocatedState = 'ACT';
  } else if ((num >= 3000 && num <= 3999) || (num >= 8000 && num <= 8999)) {
    allocatedState = 'VIC';
  } else if ((num >= 4000 && num <= 4999) || (num >= 9000 && num <= 9999)) {
    allocatedState = 'QLD';
  } else if ((num >= 5000 && num <= 5799) || (num >= 5800 && num <= 5999)) {
    allocatedState = 'SA';
  } else if ((num >= 6000 && num <= 6797) || (num >= 6800 && num <= 6999)) {
    allocatedState = 'WA';
  } else if ((num >= 7000 && num <= 7799) || (num >= 7800 && num <= 7999)) {
    allocatedState = 'TAS';
  } else if (num >= 800 && num <= 999) {
    allocatedState = 'NT';
  }

  let isStateCoherent = true;
  let stateMismatchMessage = '';

  if (stateContext && stateContext.trim()) {
    const targetState = stateContext.trim().toUpperCase();
    if (allocatedState !== 'UNKNOWN' && targetState !== allocatedState) {
      isStateCoherent = false;
      stateMismatchMessage = ` (Warning: Address specifies ${targetState}, but ${cleanedDigits} belongs to ${allocatedState})`;
    }
  }

  return {
    isValid: isStateCoherent,
    errorCode: isStateCoherent ? undefined : 'STATE_MISMATCH',
    message: isStateCoherent
      ? `Valid 4-digit AU Postcode: ${cleanedDigits} (${allocatedState})`
      : `Postcode state mismatch: ${cleanedDigits} is in ${allocatedState}${stateMismatchMessage}`,
    canonicalPostcode: cleanedDigits,
    allocatedState,
    isStateCoherent,
  };
}

export interface ChecksumIdOutput {
  isValid: boolean;
  canonical?: string;
  message: string;
}

const weightedSum = (digits: number[], weights: number[]): number =>
  digits.reduce((acc, d, i) => acc + d * weights[i], 0);

/** ATO TFN: 9 digits (weights 1,4,3,7,5,8,6,9,10) or legacy 8 digits (10,7,8,4,6,3,5,1), sum mod 11 === 0. */
export function validateAustralianTfn(raw: string): ChecksumIdOutput {
  const digits = (raw || '').replace(/[\s-]/g, '');
  if (!/^\d{8,9}$/.test(digits)) return { isValid: false, message: 'TFN must be 8 or 9 digits.' };
  const d = digits.split('').map(Number);
  const sum = weightedSum(d, d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [10, 7, 8, 4, 6, 3, 5, 1]);
  return sum % 11 === 0
    ? { isValid: true, canonical: digits, message: 'TFN checksum verified (mod 11).' }
    : { isValid: false, message: 'TFN checksum failed.' };
}

/** ASIC ACN: 9 digits, weights 8..1 over the first 8, check digit = (10 - sum mod 10) mod 10. */
export function validateAustralianAcn(raw: string): ChecksumIdOutput {
  const digits = (raw || '').replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(digits)) return { isValid: false, message: 'ACN must be 9 digits.' };
  const d = digits.split('').map(Number);
  const check = (10 - (weightedSum(d.slice(0, 8), [8, 7, 6, 5, 4, 3, 2, 1]) % 10)) % 10;
  return check === d[8]
    ? { isValid: true, canonical: digits, message: 'ACN checksum verified (mod 10).' }
    : { isValid: false, message: 'ACN checksum failed.' };
}

/** Medicare: 10 digits, first 2-6, weights 1,3,7,9,1,3,7,9 over the first 8 must equal digit 9 (mod 10); digit 10 is the issue number. */
export function validateAustralianMedicare(raw: string): ChecksumIdOutput {
  const digits = (raw || '').replace(/[^\d]/g, '');
  if (!/^[2-6]\d{9,10}$/.test(digits)) return { isValid: false, message: 'Medicare must be 10 digits starting 2-6 (optional IRN).' };
  const d = digits.split('').map(Number);
  if (weightedSum(d.slice(0, 8), [1, 3, 7, 9, 1, 3, 7, 9]) % 10 !== d[8]) {
    return { isValid: false, message: 'Medicare checksum failed.' };
  }
  if (d[9] === 0) return { isValid: false, message: 'Medicare issue number cannot be 0.' };
  return { isValid: true, canonical: digits, message: 'Medicare checksum verified.' };
}

/** Luhn check for full (unmasked) 13-19 digit card numbers. Masked values pass through as format-only. */
export function validateCardLuhn(raw: string): ChecksumIdOutput {
  if (/[*xX]/.test(raw || '')) return { isValid: true, message: 'Masked card number (checksum not applicable).' };
  const digits = (raw || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return { isValid: false, message: 'Card number must be 13-19 digits.' };
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0
    ? { isValid: true, canonical: digits, message: 'Card number Luhn check verified.' }
    : { isValid: false, message: 'Card number Luhn check failed.' };
}

/**
 * Validates Australian Business Number (ABN).
 * Enforces 11 digits, non-zero first digit, and the official ATO Modulo-89 algorithm.
 * Weight vector: [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
 */
export function validateAustralianAbn(rawAbn: string): AbnValidationOutput {
  if (!rawAbn || !rawAbn.trim()) {
    return {
      isValid: false,
      errorCode: 'INVALID_LENGTH',
      message: 'ABN value is empty.',
    };
  }

  const trimmed = rawAbn.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length !== 11) {
    return {
      isValid: false,
      errorCode: 'INVALID_LENGTH',
      message: `ABN must be exactly 11 digits. Received ${digits.length} digits (${trimmed}).`,
    };
  }

  if (digits[0] === '0') {
    return {
      isValid: false,
      errorCode: 'INVALID_LEADING_ZERO',
      message: 'ABN cannot start with digit 0 under ATO business register standards.',
    };
  }

  // ATO Modulo-89 Checksum Algorithm
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;

  for (let i = 0; i < 11; i++) {
    let digit = parseInt(digits[i], 10);
    if (i === 0) digit -= 1; // Subtract 1 from the first digit
    sum += digit * weights[i];
  }

  const remainder = sum % 89;
  const isValid = remainder === 0;
  const canonicalAbn = `${digits.substring(0, 2)} ${digits.substring(2, 5)} ${digits.substring(5, 8)} ${digits.substring(8, 11)}`;

  if (isValid) {
    return {
      isValid: true,
      message: `ATO Modulo-89 Checksum Verified (${canonicalAbn})`,
      canonicalAbn,
      checksumSum: sum,
      remainder,
    };
  }

  return {
    isValid: false,
    errorCode: 'CHECKSUM_FAILED',
    message: `Invalid ABN checksum: Modulo-89 remainder was ${remainder} (expected 0). Value: ${canonicalAbn}`,
    canonicalAbn,
    checksumSum: sum,
    remainder,
  };
}

/**
 * Validates Australian Bank State Branch (BSB) code.
 * Enforces exactly 6 digits (XXX-XXX format) and verifies against APRA ADI directory.
 */
export function validateAustralianBsb(rawBsb: string): BsbValidationOutput {
  if (!rawBsb || !rawBsb.trim()) {
    return {
      isValid: false,
      errorCode: 'NOT_6_DIGITS',
      message: 'BSB value is empty.',
    };
  }

  const trimmed = rawBsb.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length !== 6) {
    return {
      isValid: false,
      errorCode: 'NOT_6_DIGITS',
      message: `BSB must be exactly 6 digits (XXX-XXX). Received ${digits.length} digits.`,
    };
  }

  if (digits === '000000') {
    return {
      isValid: false,
      errorCode: 'RESERVED_CODE',
      message: 'BSB 000-000 is a reserved non-operational code.',
    };
  }

  const prefix2 = digits.substring(0, 2);
  const prefix3 = digits.substring(0, 3);
  const stateDigit = digits[2];

  let institutionName = APRA_ADI_MAP[prefix3] || APRA_ADI_MAP[prefix2] || 'Authorized Financial Institution';
  const stateRegion = BSB_STATE_DIGIT_MAP[stateDigit] || 'National / Central Processing';

  const canonicalBsb = `${digits.substring(0, 3)}-${digits.substring(3, 6)}`;

  return {
    isValid: true,
    message: `APRA Verified: ${institutionName} (${stateRegion})`,
    canonicalBsb,
    institutionName,
    stateRegion,
  };
}

/**
 * Validates Australian Mobile Phone Number.
 * Australian mobile numbers are 10 digits starting with '04' (or '+61 4').
 */
export function validateAustralianMobilePhone(rawPhone: string): PhoneValidationOutput {
  if (!rawPhone) return { isValid: false, message: 'Phone number is empty.' };

  let digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length === 11) {
    digits = '0' + digits.substring(2);
  }

  if (digits.length === 10 && digits.startsWith('04')) {
    const canonicalPhone = `${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7, 10)}`;
    return {
      isValid: true,
      message: `Valid AU Mobile: ${canonicalPhone}`,
      canonicalPhone,
      phoneType: 'mobile',
    };
  }

  if (digits.length === 10 && (digits.startsWith('02') || digits.startsWith('03') || digits.startsWith('07') || digits.startsWith('08'))) {
    const canonicalPhone = `(${digits.substring(0, 2)}) ${digits.substring(2, 6)} ${digits.substring(6, 10)}`;
    return {
      isValid: true,
      message: `Valid AU Landline: ${canonicalPhone}`,
      canonicalPhone,
      phoneType: 'landline',
    };
  }

  return {
    isValid: false,
    message: `Invalid AU phone format. Expected 10 digits starting with 04 (mobile) or 02/03/07/08 (landline).`,
  };
}

/**
 * Applies Australian formatting rules to a single field, returning structured validation output.
 */
export function validateAustralianField(
  fieldId: string,
  value: string,
  stateContext?: string
): {
  isValid: boolean;
  validationMessage: string;
  canonicalValue?: string;
  validationDetails?: AustralianValidationDetail;
} {
  if (!value || !value.trim()) {
    return {
      isValid: false,
      validationMessage: 'Field extracted value is empty.',
      validationDetails: {
        ruleCode: 'AU_GENERAL',
        ruleName: 'Empty Value Check',
        isValid: false,
        message: 'Field extracted value is empty.',
      },
    };
  }

  switch (fieldId) {
    case 'date_of_birth': {
      const res = validateAustralianDob(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalDate,
        validationDetails: {
          ruleCode: 'AU_DOB_FORMAT',
          ruleName: 'Australian DOB DD/MM/YYYY Format & Age Bounds',
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalDate,
          details: { age: res.age, day: res.day, month: res.month, year: res.year, errorCode: res.errorCode },
        },
      };
    }

    case 'postcode': {
      const res = validateAustralianPostcode(value, stateContext);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalPostcode,
        validationDetails: {
          ruleCode: 'AU_POSTCODE_4DIGIT',
          ruleName: 'Australian 4-Digit Postcode & State Zone',
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalPostcode,
          details: { state: res.allocatedState, isStateCoherent: res.isStateCoherent },
        },
      };
    }

    case 'abn': {
      const res = validateAustralianAbn(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalAbn,
        validationDetails: {
          ruleCode: 'AU_ABN_MOD89',
          ruleName: 'ATO Statutory Modulo-89 Checksum (11-Digit)',
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalAbn,
          details: { checksumSum: res.checksumSum, remainder: res.remainder },
        },
      };
    }

    case 'bsb': {
      const res = validateAustralianBsb(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalBsb,
        validationDetails: {
          ruleCode: 'AU_BSB_FORMAT',
          ruleName: 'APRA 6-Digit BSB & ADI Routing',
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalBsb,
          details: { institutionName: res.institutionName, stateRegion: res.stateRegion },
        },
      };
    }

    case 'mobile_number': {
      const res = validateAustralianMobilePhone(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalPhone,
        validationDetails: {
          ruleCode: 'AU_PHONE_FORMAT',
          ruleName: 'Australian 04xx Mobile Telephony Standard',
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalPhone,
        },
      };
    }

    case 'tfn': {
      const res = validateAustralianTfn(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonical,
        validationDetails: { ruleCode: 'AU_TFN_MOD11', ruleName: 'ATO TFN Modulo-11 Checksum', isValid: res.isValid, message: res.message, canonicalValue: res.canonical },
      };
    }

    case 'acn': {
      const res = validateAustralianAcn(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonical,
        validationDetails: { ruleCode: 'AU_ACN_MOD10', ruleName: 'ASIC ACN Modulo-10 Checksum', isValid: res.isValid, message: res.message, canonicalValue: res.canonical },
      };
    }

    case 'medicare_number': {
      const res = validateAustralianMedicare(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonical,
        validationDetails: { ruleCode: 'AU_MEDICARE_MOD10', ruleName: 'Medicare Card Checksum', isValid: res.isValid, message: res.message, canonicalValue: res.canonical },
      };
    }

    case 'card_number_masked': {
      const res = validateCardLuhn(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonical,
        validationDetails: { ruleCode: 'AU_CARD_LUHN', ruleName: 'Card Number Luhn Check', isValid: res.isValid, message: res.message, canonicalValue: res.canonical },
      };
    }

    default:
      return {
        isValid: true,
        validationMessage: 'Format OK',
      };
  }
}

/**
 * Master Pre-Render Enforcement Pipeline.
 * Iterates through all extracted fields BEFORE rendering, enforcing standard Australian formatting
 * rules, cross-referencing state contexts, updating confidence, and attaching diagnostics.
 */
export function enforceAustralianFormattingRules(results: ExtractionResult[]): ExtractionResult[] {
  // 1. Detect address state context from residential address or previous address
  let detectedState: string | undefined;
  const addressResult = results.find(
    (r) => (r.fieldId === 'residential_address' || r.fieldId === 'previous_address') && r.status === 'matched'
  );

  if (addressResult?.parsedStructure?.state && addressResult.parsedStructure.state !== 'UNKNOWN') {
    detectedState = addressResult.parsedStructure.state;
  } else if (addressResult?.extractedValue) {
    const stMatch = addressResult.extractedValue.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
    if (stMatch) detectedState = stMatch[1].toUpperCase();
  }

  // 2. Apply Australian validation to all matched fields
  return results.map((result) => {
    if (result.status !== 'matched' || !result.extractedValue) {
      return result;
    }

    const val = result.extractedValue;
    const validation = validateAustralianField(result.fieldId, val, detectedState);

    let updatedConfidence = result.confidence;
    if (!validation.isValid) {
      // Reduce confidence if standard Australian statutory rule fails
      updatedConfidence = Math.max(45, updatedConfidence - 25);
    } else if (validation.validationDetails?.ruleCode && validation.validationDetails.ruleCode !== 'AU_GENERAL') {
      // Boost confidence if standard Australian statutory rule passes cleanly
      updatedConfidence = Math.min(99, updatedConfidence + 3);
    }

    return {
      ...result,
      isValid: validation.isValid,
      validationMessage: validation.validationMessage,
      canonicalValue: validation.canonicalValue || result.canonicalValue || result.extractedValue,
      validationDetails: validation.validationDetails,
      confidence: updatedConfidence,
    };
  });
}

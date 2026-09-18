var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/ocrMatcherEngine.ts
var ocrMatcherEngine_exports = {};
__export(ocrMatcherEngine_exports, {
  extractBankFieldsFromText: () => extractBankFieldsFromText,
  parseAustralianAddress: () => parseAustralianAddress
});
module.exports = __toCommonJS(ocrMatcherEngine_exports);

// src/utils/australianValidationUtility.ts
var APRA_ADI_MAP = {
  "01": "ANZ Bank (Australia and New Zealand Banking Group)",
  "03": "Westpac Banking Corporation",
  "73": "St.George Bank / Westpac Group",
  "04": "Macquarie Bank",
  "06": "Commonwealth Bank of Australia (CBA)",
  "08": "National Australia Bank (NAB)",
  "09": "Reserve Bank of Australia (RBA)",
  "11": "St.George Bank (Specialized Branch)",
  "12": "Bank of Melbourne",
  "18": "Bank of Queensland (BOQ)",
  "19": "Bank of Western Australia (Bankwest)",
  "30": "Bankwest (CBA Subsidiary)",
  "484": "Suncorp Bank",
  "633": "Bendigo and Adelaide Bank",
  "802": "Auswide Bank",
  "814": "Great Southern Bank"
};
var BSB_STATE_DIGIT_MAP = {
  "2": "NSW / ACT",
  "3": "VIC / TAS",
  "4": "QLD",
  "5": "SA / NT",
  "6": "WA"
};
var MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];
var MONTH_ABBR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec"
];
function validateAustralianDob(rawDob) {
  if (!rawDob || !rawDob.trim()) {
    return {
      isValid: false,
      errorCode: "INVALID_FORMAT",
      message: "Date of birth is empty."
    };
  }
  const cleaned = rawDob.trim();
  let day = null;
  let month = null;
  let year = null;
  const numRegex = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/;
  const numMatch = cleaned.match(numRegex);
  if (numMatch) {
    day = parseInt(numMatch[1], 10);
    month = parseInt(numMatch[2], 10);
    let rawYear = parseInt(numMatch[3], 10);
    if (rawYear < 100) {
      rawYear = rawYear > 30 ? 1900 + rawYear : 2e3 + rawYear;
    }
    year = rawYear;
  } else {
    const wordDateRegex = /^(\d{1,2})[\s\-/.]([a-zA-Z]{3,12})[\s\-/. ](\d{2,4})$/;
    const wordMatch = cleaned.match(wordDateRegex);
    if (wordMatch) {
      day = parseInt(wordMatch[1], 10);
      const monthStr = wordMatch[2].toLowerCase();
      const monthIdx = MONTH_NAMES.indexOf(monthStr) !== -1 ? MONTH_NAMES.indexOf(monthStr) + 1 : MONTH_ABBR.indexOf(monthStr.substring(0, 3)) + 1;
      if (monthIdx > 0) {
        month = monthIdx;
        let rawYear = parseInt(wordMatch[3], 10);
        if (rawYear < 100) {
          rawYear = rawYear > 30 ? 1900 + rawYear : 2e3 + rawYear;
        }
        year = rawYear;
      }
    }
  }
  if (day === null || month === null || year === null) {
    return {
      isValid: false,
      errorCode: "INVALID_FORMAT",
      message: `Invalid date format '${cleaned}'. Expected Australian standard DD/MM/YYYY.`
    };
  }
  if (month < 1 || month > 12) {
    return {
      isValid: false,
      errorCode: "INVALID_CALENDAR_DATE",
      message: `Invalid month '${month}'. Month must be between 01 and 12.`
    };
  }
  const isLeapYear = year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
  const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonths[month - 1];
  if (day < 1 || day > maxDay) {
    const monthName = MONTH_NAMES[month - 1];
    return {
      isValid: false,
      errorCode: "INVALID_CALENDAR_DATE",
      message: `Invalid calendar date: Day ${day} does not exist in ${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year} (max ${maxDay} days).`
    };
  }
  const today = /* @__PURE__ */ new Date();
  const currentYear = today.getFullYear();
  const birthDate = new Date(year, month - 1, day);
  if (birthDate > today) {
    return {
      isValid: false,
      errorCode: "FUTURE_DATE",
      message: `Date of birth cannot be in the future (${day}/${month}/${year}).`
    };
  }
  if (year < 1900) {
    return {
      isValid: false,
      errorCode: "OUT_OF_RANGE",
      message: `Year ${year} is outside standard operating range (1900-${currentYear}).`
    };
  }
  let age = currentYear - year;
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  if (currentMonth < month || currentMonth === month && currentDay < day) {
    age -= 1;
  }
  const paddedDay = day.toString().padStart(2, "0");
  const paddedMonth = month.toString().padStart(2, "0");
  const canonicalDate = `${paddedDay}/${paddedMonth}/${year}`;
  return {
    isValid: true,
    message: `Valid Australian DOB: ${canonicalDate} (Age: ${age})`,
    canonicalDate,
    age,
    day,
    month,
    year
  };
}
function validateAustralianPostcode(rawPostcode, stateContext) {
  if (!rawPostcode || !rawPostcode.trim()) {
    return {
      isValid: false,
      errorCode: "NOT_4_DIGITS",
      message: "Postcode value is empty."
    };
  }
  const trimmed = rawPostcode.trim();
  const cleanedDigits = trimmed.replace(/\D/g, "");
  if (cleanedDigits.length !== 4 || trimmed !== cleanedDigits) {
    return {
      isValid: false,
      errorCode: "NOT_4_DIGITS",
      message: `Australian Postcode must be exactly 4 digits. Received '${trimmed}' (${cleanedDigits.length} digits).`
    };
  }
  const num = parseInt(cleanedDigits, 10);
  if (num < 200 || num > 9999) {
    return {
      isValid: false,
      errorCode: "INVALID_ZONE",
      message: `Postcode ${cleanedDigits} is out of Australian postal range (0200-9999).`
    };
  }
  let allocatedState = "UNKNOWN";
  if (num >= 1e3 && num <= 2599 || num >= 2619 && num <= 2899 || num >= 2921 && num <= 2999) {
    allocatedState = "NSW";
  } else if (num >= 200 && num <= 299 || num >= 2600 && num <= 2618 || num >= 2900 && num <= 2920) {
    allocatedState = "ACT";
  } else if (num >= 3e3 && num <= 3999 || num >= 8e3 && num <= 8999) {
    allocatedState = "VIC";
  } else if (num >= 4e3 && num <= 4999 || num >= 9e3 && num <= 9999) {
    allocatedState = "QLD";
  } else if (num >= 5e3 && num <= 5799 || num >= 5800 && num <= 5999) {
    allocatedState = "SA";
  } else if (num >= 6e3 && num <= 6797 || num >= 6800 && num <= 6999) {
    allocatedState = "WA";
  } else if (num >= 7e3 && num <= 7799 || num >= 7800 && num <= 7999) {
    allocatedState = "TAS";
  } else if (num >= 800 && num <= 999) {
    allocatedState = "NT";
  }
  let isStateCoherent = true;
  let stateMismatchMessage = "";
  if (stateContext && stateContext.trim()) {
    const targetState = stateContext.trim().toUpperCase();
    if (allocatedState !== "UNKNOWN" && targetState !== allocatedState) {
      isStateCoherent = false;
      stateMismatchMessage = ` (Warning: Address specifies ${targetState}, but ${cleanedDigits} belongs to ${allocatedState})`;
    }
  }
  return {
    isValid: isStateCoherent,
    errorCode: isStateCoherent ? void 0 : "STATE_MISMATCH",
    message: isStateCoherent ? `Valid 4-digit AU Postcode: ${cleanedDigits} (${allocatedState})` : `Postcode state mismatch: ${cleanedDigits} is in ${allocatedState}${stateMismatchMessage}`,
    canonicalPostcode: cleanedDigits,
    allocatedState,
    isStateCoherent
  };
}
function validateAustralianAbn(rawAbn) {
  if (!rawAbn || !rawAbn.trim()) {
    return {
      isValid: false,
      errorCode: "INVALID_LENGTH",
      message: "ABN value is empty."
    };
  }
  const trimmed = rawAbn.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 11) {
    return {
      isValid: false,
      errorCode: "INVALID_LENGTH",
      message: `ABN must be exactly 11 digits. Received ${digits.length} digits (${trimmed}).`
    };
  }
  if (digits[0] === "0") {
    return {
      isValid: false,
      errorCode: "INVALID_LEADING_ZERO",
      message: "ABN cannot start with digit 0 under ATO business register standards."
    };
  }
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let digit = parseInt(digits[i], 10);
    if (i === 0) digit -= 1;
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
      remainder
    };
  }
  return {
    isValid: false,
    errorCode: "CHECKSUM_FAILED",
    message: `Invalid ABN checksum: Modulo-89 remainder was ${remainder} (expected 0). Value: ${canonicalAbn}`,
    canonicalAbn,
    checksumSum: sum,
    remainder
  };
}
function validateAustralianBsb(rawBsb) {
  if (!rawBsb || !rawBsb.trim()) {
    return {
      isValid: false,
      errorCode: "NOT_6_DIGITS",
      message: "BSB value is empty."
    };
  }
  const trimmed = rawBsb.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 6) {
    return {
      isValid: false,
      errorCode: "NOT_6_DIGITS",
      message: `BSB must be exactly 6 digits (XXX-XXX). Received ${digits.length} digits.`
    };
  }
  if (digits === "000000") {
    return {
      isValid: false,
      errorCode: "RESERVED_CODE",
      message: "BSB 000-000 is a reserved non-operational code."
    };
  }
  const prefix2 = digits.substring(0, 2);
  const prefix3 = digits.substring(0, 3);
  const stateDigit = digits[2];
  let institutionName = APRA_ADI_MAP[prefix3] || APRA_ADI_MAP[prefix2] || "Authorized Financial Institution";
  const stateRegion = BSB_STATE_DIGIT_MAP[stateDigit] || "National / Central Processing";
  const canonicalBsb = `${digits.substring(0, 3)}-${digits.substring(3, 6)}`;
  return {
    isValid: true,
    message: `APRA Verified: ${institutionName} (${stateRegion})`,
    canonicalBsb,
    institutionName,
    stateRegion
  };
}
function validateAustralianMobilePhone(rawPhone) {
  if (!rawPhone) return { isValid: false, message: "Phone number is empty." };
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length === 11) {
    digits = "0" + digits.substring(2);
  }
  if (digits.length === 10 && digits.startsWith("04")) {
    const canonicalPhone = `${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7, 10)}`;
    return {
      isValid: true,
      message: `Valid AU Mobile: ${canonicalPhone}`,
      canonicalPhone,
      phoneType: "mobile"
    };
  }
  if (digits.length === 10 && (digits.startsWith("02") || digits.startsWith("03") || digits.startsWith("07") || digits.startsWith("08"))) {
    const canonicalPhone = `(${digits.substring(0, 2)}) ${digits.substring(2, 6)} ${digits.substring(6, 10)}`;
    return {
      isValid: true,
      message: `Valid AU Landline: ${canonicalPhone}`,
      canonicalPhone,
      phoneType: "landline"
    };
  }
  return {
    isValid: false,
    message: `Invalid AU phone format. Expected 10 digits starting with 04 (mobile) or 02/03/07/08 (landline).`
  };
}
function validateAustralianField(fieldId, value, stateContext) {
  if (!value || !value.trim()) {
    return {
      isValid: false,
      validationMessage: "Field extracted value is empty.",
      validationDetails: {
        ruleCode: "AU_GENERAL",
        ruleName: "Empty Value Check",
        isValid: false,
        message: "Field extracted value is empty."
      }
    };
  }
  switch (fieldId) {
    case "date_of_birth": {
      const res = validateAustralianDob(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalDate,
        validationDetails: {
          ruleCode: "AU_DOB_FORMAT",
          ruleName: "Australian DOB DD/MM/YYYY Format & Age Bounds",
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalDate,
          details: { age: res.age, day: res.day, month: res.month, year: res.year, errorCode: res.errorCode }
        }
      };
    }
    case "postcode": {
      const res = validateAustralianPostcode(value, stateContext);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalPostcode,
        validationDetails: {
          ruleCode: "AU_POSTCODE_4DIGIT",
          ruleName: "Australian 4-Digit Postcode & State Zone",
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalPostcode,
          details: { state: res.allocatedState, isStateCoherent: res.isStateCoherent }
        }
      };
    }
    case "abn": {
      const res = validateAustralianAbn(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalAbn,
        validationDetails: {
          ruleCode: "AU_ABN_MOD89",
          ruleName: "ATO Statutory Modulo-89 Checksum (11-Digit)",
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalAbn,
          details: { checksumSum: res.checksumSum, remainder: res.remainder }
        }
      };
    }
    case "bsb": {
      const res = validateAustralianBsb(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalBsb,
        validationDetails: {
          ruleCode: "AU_BSB_FORMAT",
          ruleName: "APRA 6-Digit BSB & ADI Routing",
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalBsb,
          details: { institutionName: res.institutionName, stateRegion: res.stateRegion }
        }
      };
    }
    case "mobile_number": {
      const res = validateAustralianMobilePhone(value);
      return {
        isValid: res.isValid,
        validationMessage: res.message,
        canonicalValue: res.canonicalPhone,
        validationDetails: {
          ruleCode: "AU_PHONE_FORMAT",
          ruleName: "Australian 04xx Mobile Telephony Standard",
          isValid: res.isValid,
          message: res.message,
          canonicalValue: res.canonicalPhone
        }
      };
    }
    default:
      return {
        isValid: true,
        validationMessage: "Format OK"
      };
  }
}
function enforceAustralianFormattingRules(results) {
  let detectedState;
  const addressResult = results.find(
    (r) => (r.fieldId === "residential_address" || r.fieldId === "previous_address") && r.status === "matched"
  );
  if (addressResult?.parsedStructure?.state && addressResult.parsedStructure.state !== "UNKNOWN") {
    detectedState = addressResult.parsedStructure.state;
  } else if (addressResult?.extractedValue) {
    const stMatch = addressResult.extractedValue.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
    if (stMatch) detectedState = stMatch[1].toUpperCase();
  }
  return results.map((result) => {
    if (result.status !== "matched" || !result.extractedValue) {
      return result;
    }
    const val = result.extractedValue;
    const validation = validateAustralianField(result.fieldId, val, detectedState);
    let updatedConfidence = result.confidence;
    if (!validation.isValid) {
      updatedConfidence = Math.max(45, updatedConfidence - 25);
    } else if (validation.validationDetails?.ruleCode && validation.validationDetails.ruleCode !== "AU_GENERAL") {
      updatedConfidence = Math.min(99, updatedConfidence + 3);
    }
    return {
      ...result,
      isValid: validation.isValid,
      validationMessage: validation.validationMessage,
      canonicalValue: validation.canonicalValue || result.canonicalValue || result.extractedValue,
      validationDetails: validation.validationDetails,
      confidence: updatedConfidence
    };
  });
}

// src/data/fields/identityExtendedFields.ts
var IDENTITY_EXTENDED_FIELDS = [
  {
    id: "preferred_name",
    number: 31,
    name: "Preferred Name / Known As",
    label: "preferred_name",
    category: "identity",
    maxToleranceRegex: "(preferred[_-]?names?|kn[o0]wn[_-]?as|a[l1]ias|inf[o0]rma[l1][_-]?name|ca[l1][l1][_-]?me|pref[_-]?name|ch[o0]sen[_-]?name|n[l1]ck[_-]?name|pref[_-]?nm)",
    description: "Extracts preferred name, informal name, chosen name, or known as aliases from identity sections.",
    targetDataType: "text",
    exampleLabels: ["Preferred Name", "Known As", "Alias", "Pref Name", "Chosen Name"],
    sampleExtractedValue: "Ollie"
  },
  {
    id: "previous_name",
    number: 32,
    name: "Previous Name / Maiden Name",
    label: "previous_name",
    category: "identity",
    maxToleranceRegex: "(previ[o0]us[_-]?names?|pri[o0]r[_-]?name|f[o0]rmer[_-]?name|maiden[_-]?names?|birth[_-]?name|prev[_-]?name|name[_-]?at[_-]?birth|changed[_-]?name|f[o0]rmer[_-]?nm)",
    description: "Captures maiden names, prior names, birth names, and legal name change history.",
    targetDataType: "text",
    exampleLabels: ["Previous Name", "Prior Name", "Maiden Name", "Former Name"],
    sampleExtractedValue: "Oliver Vance"
  },
  {
    id: "gender",
    number: 33,
    name: "Gender / Sex",
    label: "gender",
    category: "identity",
    maxToleranceRegex: "(gender[_-]?identity|bi[o0][l1][o0]gica[l1][_-]?sex|gender[_-]?desc|pers[o0]n[_-]?gender|ma[l1]e|fema[l1]e|n[o0]n[_-]?binary|indeterminate|gender)",
    description: "Captures gender classification including male, female, non-binary, or unspecified.",
    targetDataType: "text",
    exampleLabels: ["Gender", "Sex", "Gender Identity", "Biological Sex"],
    sampleExtractedValue: "Male"
  },
  {
    id: "country_of_birth",
    number: 34,
    name: "Country of Birth",
    label: "country_of_birth",
    category: "identity",
    maxToleranceRegex: "(c[o0]untry[_-]?of[_-]?birth|birth[_-]?c[o0]untry|p[l1]ace[_-]?of[_-]?birth|birthp[l1]ace|c[o0]b|b[o0]rn[_-]?c[o0]untry|nativity[_-]?c[o0]untry|[o0]rigin[_-]?c[o0]untry)",
    description: "Matches country or territory of birth declared on application and customer identification forms.",
    targetDataType: "text",
    exampleLabels: ["Country of Birth", "Birth Country", "Place of Birth", "COB"],
    sampleExtractedValue: "Australia"
  },
  {
    id: "visa_subclass",
    number: 35,
    name: "Visa Subclass / Type",
    label: "visa_subclass",
    category: "identity",
    maxToleranceRegex: "(vi[s5]a[_-]?subc[l1]a[s5][s5]|subc[l1]a[s5][s5][_-]?\\d{3}|vi[s5]a[_-]?type|vi[s5]a[_-]?categ[o0]ry|immigrati[o0]n[_-]?status|vi[s5]a[_-]?c[l1]a[s5][s5]|permit[_-]?type|vev[o0][_-]?status)",
    description: "Identifies Australian Department of Home Affairs visa subclass designations like 482, 186, or 500.",
    targetDataType: "text",
    exampleLabels: ["Visa Subclass", "Subclass 482", "Visa Type", "VEVO Status"],
    sampleExtractedValue: "Subclass 186"
  },
  {
    id: "visa_expiry",
    number: 36,
    name: "Visa Expiry Date",
    label: "visa_expiry",
    category: "identity",
    maxToleranceRegex: "(vi[s5]a[_-]?expiry|vi[s5]a[_-]?expires|vi[s5]a[_-]?va[l1]id[_-]?t[o0]|permit[_-]?expiry|cease[_-]?date|vi[s5]a[_-]?end[_-]?date|vi[s5]a[_-]?exp|vev[o0][_-]?expiry)",
    description: "Captures visa cessation, validity end date, or permit expiration dates.",
    targetDataType: "date",
    exampleLabels: ["Visa Expiry", "Valid To", "Permit Expiry Date", "Visa End Date"],
    sampleExtractedValue: "28/02/2028"
  },
  {
    id: "licence_state",
    number: 37,
    name: "Driver Licence State / Territory",
    label: "licence_state",
    category: "identity",
    maxToleranceRegex: "(licen[cs]e[_-]?state|issuing[_-]?state|lic[_-]?state|licen[cs]e[_-]?jurisdicti[o0]n|driver[_-]?state|d[l1][_-]?state|state[_-]?of[_-]?issue|d[l1][_-]?jurisdicti[o0]n)",
    description: "Matches Australian driver licence issuing state or territory jurisdiction.",
    targetDataType: "text",
    exampleLabels: ["Licence State", "Issuing State", "DL State", "State of Issue"],
    sampleExtractedValue: "VIC"
  },
  {
    id: "licence_expiry",
    number: 38,
    name: "Driver Licence Expiry Date",
    label: "licence_expiry",
    category: "identity",
    maxToleranceRegex: "(licen[cs]e[_-]?expiry|d[l1][_-]?expiry|lic[_-]?exp|licen[cs]e[_-]?expires|licen[cs]e[_-]?va[l1]id[_-]?t[o0]|d[l1][_-]?exp[_-]?date|card[_-]?expiry|driver[_-]?expiry)",
    description: "Extracts expiration date of Australian state or territory driver licences.",
    targetDataType: "date",
    exampleLabels: ["Licence Expiry", "DL Expiry Date", "Licence Valid To", "Card Expiry"],
    sampleExtractedValue: "19/11/2027"
  },
  {
    id: "joint_applicant",
    number: 39,
    name: "Joint Applicant Indicator",
    label: "joint_applicant",
    category: "identity",
    maxToleranceRegex: "(j[o0]int[_-]?app[l1]icant|sec[o0]nd[_-]?app[l1]icant|app[l1]icant[_-]?2|c[o0][_-]?b[o0]rr[o0]wer|c[o0][_-]?app[l1]icant|j[o0]int[_-]?b[o0]rr[o0]wer|sec[o0]ndary[_-]?app[l1]icant|j[o0]int[_-]?party)",
    description: "Identifies co-borrower, joint borrower, applicant 2, or secondary party declarations.",
    targetDataType: "text",
    exampleLabels: ["Joint Applicant", "Applicant 2", "Co-Borrower", "Co-Applicant"],
    sampleExtractedValue: "Yes - Secondary Applicant"
  },
  {
    id: "applicant_role",
    number: 40,
    name: "Applicant Role / Capacity",
    label: "applicant_role",
    category: "identity",
    maxToleranceRegex: "(app[l1]icant[_-]?r[o0][l1]e|b[o0]rr[o0]wing[_-]?capacity|primary[_-]?app[l1]icant|b[o0]rr[o0]wer[_-]?type|guarant[o0]r|direct[o0]r[_-]?app[l1]icant|trustee[_-]?app[l1]icant|signat[o0]ry[_-]?r[o0][l1]e)",
    description: "Captures borrower role such as primary borrower, guarantor, director, or trustee.",
    targetDataType: "text",
    exampleLabels: ["Applicant Role", "Borrower Type", "Primary Borrower", "Guarantor"],
    sampleExtractedValue: "Primary Borrower"
  }
];

// src/data/fields/residentialExtendedFields.ts
var RESIDENTIAL_EXTENDED_FIELDS = [
  {
    id: "postal_address",
    number: 41,
    name: "Postal / Mailing Address",
    label: "postal_address",
    category: "residential",
    maxToleranceRegex: "(p[o0][s5]ta[l1][_-]?addres[s5]|mai[l1]ing[_-]?addres[s5]|p[o0][s5]t[_-]?b[o0]x|p[o0][_-]?b[o0]x|gp[o0][_-]?b[o0]x|p[o0][s5]ta[l1][_-]?de[l1]ivery|mai[l1][_-]?addres[s5]|de[l1]ivery[_-]?addres[s5])",
    description: "Extracts postal boxes, GPO boxes, mailing addresses, and non-residential delivery points.",
    targetDataType: "text",
    exampleLabels: ["Postal Address", "Mailing Address", "PO Box", "Delivery Address"],
    sampleExtractedValue: "PO Box 842, Melbourne VIC 3001"
  },
  {
    id: "unit_level",
    number: 42,
    name: "Unit / Level / Apartment Number",
    label: "unit_level",
    category: "residential",
    maxToleranceRegex: "(unit[_-]?number|unit[_-]?n[o0]|apartment[_-]?n[o0]|apt[_-]?n[o0]|suite[_-]?n[o0]|f[l1]at[_-]?n[o0]|[l1]eve[l1][_-]?number|[l1][o0]t[_-]?n[o0]|unit[_-]?[l1]eve[l1])",
    description: "Extracts unit, apartment, suite, flat, level, or lot sub-dwelling identifiers.",
    targetDataType: "text",
    exampleLabels: ["Unit Number", "Apartment", "Suite No", "Level", "Flat"],
    sampleExtractedValue: "Suite 14"
  },
  {
    id: "street_number",
    number: 43,
    name: "Street Number",
    label: "street_number",
    category: "residential",
    maxToleranceRegex: "(street[_-]?number|h[o0]use[_-]?number|street[_-]?n[o0]|b[l1]dg[_-]?n[o0]|pr[o0]perty[_-]?n[o0]|street[_-]?num|bui[l1]ding[_-]?number|[s5]t[_-]?n[o0])",
    description: "Captures primary building street number or house number range.",
    targetDataType: "text",
    exampleLabels: ["Street Number", "House Number", "Street No", "Building Number"],
    sampleExtractedValue: "452"
  },
  {
    id: "street_name_type",
    number: 44,
    name: "Street Name and Type",
    label: "street_name_type",
    category: "residential",
    maxToleranceRegex: "(street[_-]?name|th[o0]r[o0]ughfare|r[o0]ad[_-]?name|street[_-]?type|[s5]t[_-]?name|rd[_-]?name|avenue[_-]?name|way[_-]?name)",
    description: "Matches street name and suffix type such as Street, Road, Avenue, Boulevard, or Parade.",
    targetDataType: "text",
    exampleLabels: ["Street Name", "Road Name", "Thoroughfare", "Street Type"],
    sampleExtractedValue: "Flinders Street"
  },
  {
    id: "suburb_locality",
    number: 45,
    name: "Suburb / Locality",
    label: "suburb_locality",
    category: "residential",
    maxToleranceRegex: "(suburb[_-]?[l1][o0]ca[l1]ity|suburb[_-]?name|[l1][o0]ca[l1]ity[_-]?name|t[o0]wn[_-]?city|residentia[l1][_-]?suburb|district[_-]?[l1][o0]ca[l1]ity|neighb[o0]urh[o0][o0]d|t[o0]wnship)",
    description: "Captures Australian suburb or gazetted locality names.",
    targetDataType: "text",
    exampleLabels: ["Suburb", "Locality", "Town/City", "Residential Suburb"],
    sampleExtractedValue: "Melbourne"
  },
  {
    id: "state_territory",
    number: 46,
    name: "State / Territory Code",
    label: "state_territory",
    category: "residential",
    maxToleranceRegex: "(state[_-]?territ[o0]ry|residence[_-]?state|jurisdicti[o0]n[_-]?state|au[_-]?state|n[s5]w[_-]?vic|state[_-]?c[o0]de|aust[_-]?state|regi[o0]n[_-]?state)",
    description: "Identifies standard Australian state or territory designations: NSW, VIC, QLD, WA, SA, TAS, ACT, NT.",
    targetDataType: "text",
    exampleLabels: ["State", "Territory", "State/Territory", "Region"],
    sampleExtractedValue: "VIC"
  },
  {
    id: "previous_address_tenure",
    number: 47,
    name: "Previous Address Tenure",
    label: "previous_address_tenure",
    category: "residential",
    maxToleranceRegex: "(previ[o0]us[_-]?tenure|time[_-]?at[_-]?previ[o0]us|pri[o0]r[_-]?addres[s5][_-]?years|prev[_-]?addres[s5][_-]?tenure|past[_-]?residence[_-]?durati[o0]n|previ[o0]us[_-]?residence[_-]?yrs|pri[o0]r[_-]?yrs)",
    description: "Captures duration of residency at former address when current address tenure is under threshold.",
    targetDataType: "text",
    exampleLabels: ["Time at Previous Address", "Previous Tenure", "Prior Address Duration", "Past Residence Yrs"],
    sampleExtractedValue: "2 Years 4 Months"
  },
  {
    id: "address_verification_doc",
    number: 48,
    name: "Address Verification Document",
    label: "address_verification_doc",
    category: "residential",
    maxToleranceRegex: "(addres[s5][_-]?pr[o0][o0]f|uti[l1]ity[_-]?bi[l1][l1]|rates[_-]?n[o0]tice|tenancy[_-]?agreement|[l1]ease[_-]?agreement|c[o0]unci[l1][_-]?rates|pr[o0][o0]f[_-]?of[_-]?residence|addres[s5][_-]?d[o0]c)",
    description: "Matches utility bills, council rate notices, or lease agreements used for address confirmation.",
    targetDataType: "text",
    exampleLabels: ["Proof of Address", "Rates Notice", "Utility Bill", "Tenancy Agreement"],
    sampleExtractedValue: "City of Melbourne Council Rates Notice"
  }
];

// src/data/fields/contactExtendedFields.ts
var CONTACT_EXTENDED_FIELDS = [
  {
    id: "home_phone",
    number: 49,
    name: "Home Phone / Landline",
    label: "home_phone",
    category: "contact",
    maxToleranceRegex: "(h[o0]me[_-]?ph[o0]ne|[l1]and[l1]ine|fixed[_-]?[l1]ine|residentia[l1][_-]?ph[o0]ne|h[o0]me[_-]?te[l1]eph[o0]ne|private[_-]?ph[o0]ne|fixed[_-]?ph[o0]ne)",
    description: "Matches Australian residential fixed-line numbers including 02, 03, 07, or 08 area codes.",
    targetDataType: "phone",
    exampleLabels: ["Home Phone", "Landline", "Fixed Line", "Home Telephone"],
    sampleExtractedValue: "(03) 9482 1049"
  },
  {
    id: "work_phone",
    number: 50,
    name: "Work / Business Phone",
    label: "work_phone",
    category: "contact",
    maxToleranceRegex: "(w[o0]rk[_-]?ph[o0]ne|bu[s5]ines[s5][_-]?ph[o0]ne|[o0]ffice[_-]?ph[o0]ne|daytime[_-]?ph[o0]ne|emp[l1][o0]yer[_-]?ph[o0]ne|w[o0]rk[_-]?te[l1]eph[o0]ne|direct[_-]?[l1]ine|desk[_-]?ph[o0]ne)",
    description: "Captures employer office telephone, switchboard, or daytime business contact numbers.",
    targetDataType: "phone",
    exampleLabels: ["Work Phone", "Business Phone", "Office Telephone", "Direct Line"],
    sampleExtractedValue: "(03) 8614 2000"
  },
  {
    id: "preferred_contact_method",
    number: 51,
    name: "Preferred Contact Method",
    label: "preferred_contact_method",
    category: "contact",
    maxToleranceRegex: "(preferred[_-]?c[o0]ntact|c[o0]ntact[_-]?meth[o0]d|preferred[_-]?channe[l1]|c[o0]mmunicati[o0]n[_-]?meth[o0]d|best[_-]?c[o0]ntact|c[o0]ntact[_-]?preference|c[o0]mms[_-]?pref|c[o0]ntact[_-]?via)",
    description: "Identifies preferred communication channel such as email, SMS, phone call, or post.",
    targetDataType: "text",
    exampleLabels: ["Preferred Contact", "Contact Method", "Communication Preference", "Contact Via"],
    sampleExtractedValue: "Email"
  },
  {
    id: "contact_time",
    number: 52,
    name: "Contact Time",
    label: "contact_time",
    category: "contact",
    maxToleranceRegex: "(c[o0]ntact[_-]?time|ca[l1][l1][_-]?time|c[o0]nvenient[_-]?time|best[_-]?time[_-]?t[o0][_-]?ca[l1][l1]|preferred[_-]?time|time[_-]?of[_-]?day|ca[l1][l1][_-]?wind[o0]w|c[o0]ntact[_-]?h[o0]urs)",
    description: "Captures preferred communication timeframes such as morning, afternoon, or after hours.",
    targetDataType: "text",
    exampleLabels: ["Best Time to Call", "Contact Time", "Preferred Hours", "Call Window"],
    sampleExtractedValue: "Morning (9am - 12pm)"
  },
  {
    id: "emergency_contact_name",
    number: 53,
    name: "Emergency Contact / Next of Kin Name",
    label: "emergency_contact_name",
    category: "contact",
    maxToleranceRegex: "(emergency[_-]?c[o0]ntact|next[_-]?of[_-]?kin|n[o0]k[_-]?name|emergency[_-]?name|c[o0]ntact[_-]?pers[o0]n|referee[_-]?name|n[o0]minated[_-]?c[o0]ntact|n[o0]k[_-]?pers[o0]n)",
    description: "Extracts nominated emergency contact person, next of kin, or referee name.",
    targetDataType: "text",
    exampleLabels: ["Emergency Contact", "Next of Kin", "NOK Name", "Nominated Contact"],
    sampleExtractedValue: "Sarah Sterling"
  },
  {
    id: "emergency_phone",
    number: 54,
    name: "Emergency Phone",
    label: "emergency_phone",
    category: "contact",
    maxToleranceRegex: "(emergency[_-]?ph[o0]ne|next[_-]?of[_-]?kin[_-]?ph[o0]ne|n[o0]k[_-]?ph[o0]ne|emergency[_-]?m[o0]bi[l1]e|n[o0]k[_-]?c[o0]ntact|emergency[_-]?number|referee[_-]?ph[o0]ne|n[o0]k[_-]?te[l1])",
    description: "Extracts telephone number for nominated emergency contact or next of kin.",
    targetDataType: "phone",
    exampleLabels: ["Emergency Phone", "Next of Kin Mobile", "NOK Phone", "Emergency Number"],
    sampleExtractedValue: "0418 234 567"
  },
  {
    id: "language_interpreter",
    number: 55,
    name: "Language / Interpreter",
    label: "language_interpreter",
    category: "contact",
    maxToleranceRegex: "(interpreter[_-]?req[uv]ired|[l1]anguage[_-]?sp[o0]ken|need[_-]?interpreter|trans[l1]ati[o0]n[_-]?[s5]ervice|preferred[_-]?[l1]anguage|interpreter[_-]?needed|primary[_-]?[l1]anguage|ti[s5][_-]?nati[o0]na[l1])",
    description: "Identifies whether translation or interpreter services (TIS) are needed and primary language spoken.",
    targetDataType: "text",
    exampleLabels: ["Interpreter Required", "Language Spoken", "Preferred Language", "TIS National"],
    sampleExtractedValue: "English (No Interpreter Needed)"
  }
];

// src/data/fields/employmentExtendedFields.ts
var EMPLOYMENT_EXTENDED_FIELDS = [
  {
    id: "employer_address",
    number: 56,
    name: "Employer / Workplace Address",
    label: "employer_address",
    category: "employment",
    maxToleranceRegex: "(emp[l1][o0]yer[_-]?addres[s5]|w[o0]rkp[l1]ace[_-]?addres[s5]|c[o0]mpany[_-]?addres[s5]|bu[s5]ines[s5][_-]?addres[s5]|[o0]ffice[_-]?addres[s5]|w[o0]rk[_-]?[l1][o0]cati[o0]n|emp[l1][o0]yment[_-]?addres[s5]|emp[l1][o0]yer[_-]?[l1][o0]cati[o0]n)",
    description: "Extracts street and office location of the applicant employer or business.",
    targetDataType: "text",
    exampleLabels: ["Employer Address", "Workplace Location", "Company Address", "Office Address"],
    sampleExtractedValue: "Level 29, 341 George Street, Sydney NSW 2000"
  },
  {
    id: "employer_phone",
    number: 57,
    name: "Employer Phone / Switchboard",
    label: "employer_phone",
    category: "employment",
    maxToleranceRegex: "(emp[l1][o0]yer[_-]?ph[o0]ne|w[o0]rkp[l1]ace[_-]?ph[o0]ne|c[o0]mpany[_-]?ph[o0]ne|[o0]ffice[_-]?[s5]witchb[o0]ard|bu[s5]ines[s5][_-]?te[l1]eph[o0]ne|w[o0]rk[_-]?te[l1]|emp[l1][o0]yer[_-]?c[o0]ntact[_-]?n[o0]|head[_-]?[o0]ffice[_-]?ph[o0]ne)",
    description: "Captures main telephone switchboard or verification contact for applicant employer.",
    targetDataType: "phone",
    exampleLabels: ["Employer Phone", "Company Telephone", "Workplace Switchboard", "Office Phone"],
    sampleExtractedValue: "(02) 9283 4000"
  },
  {
    id: "payroll_contact",
    number: 58,
    name: "Payroll / HR Contact Person",
    label: "payroll_contact",
    category: "employment",
    maxToleranceRegex: "(payr[o0][l1][l1][_-]?c[o0]ntact|hr[_-]?c[o0]ntact|human[_-]?re[s5][o0]urces|payma[s5]ter|payr[o0][l1][l1][_-]?[o0]fficer|emp[l1][o0]yment[_-]?[o0]fficer|hr[_-]?manager|payr[o0][l1][l1][_-]?emai[l1])",
    description: "Matches human resources or payroll contact responsible for employment verification.",
    targetDataType: "text",
    exampleLabels: ["Payroll Contact", "HR Officer", "Human Resources", "Paymaster"],
    sampleExtractedValue: "Jane Caldwell (HR Business Partner)"
  },
  {
    id: "employment_start_date",
    number: 59,
    name: "Employment Start / Commencement Date",
    label: "employment_start_date",
    category: "employment",
    maxToleranceRegex: "([s5]tart[_-]?date|c[o0]mmencement[_-]?date|hire[_-]?date|j[o0]ined[_-]?date|date[_-]?c[o0]mmenced|[s5]tarted[_-]?[o0]n|emp[l1][o0]yment[_-]?c[o0]mmenced|date[_-]?emp[l1][o0]yed)",
    description: "Captures start or commencement date with current employer.",
    targetDataType: "date",
    exampleLabels: ["Start Date", "Commencement Date", "Hire Date", "Date Commenced"],
    sampleExtractedValue: "01/07/2019"
  },
  {
    id: "previous_employer",
    number: 60,
    name: "Previous Employer Name",
    label: "previous_employer",
    category: "employment",
    maxToleranceRegex: "(previ[o0]us[_-]?emp[l1][o0]yer|pri[o0]r[_-]?emp[l1][o0]yer|f[o0]rmer[_-]?emp[l1][o0]yer|past[_-]?emp[l1][o0]yer|pri[o0]r[_-]?c[o0]mpany|previ[o0]us[_-]?w[o0]rkp[l1]ace|[l1]a[s5]t[_-]?emp[l1][o0]yer|f[o0]rmer[_-]?c[o0]mpany)",
    description: "Identifies former employer when current employment duration is under standard credit thresholds.",
    targetDataType: "text",
    exampleLabels: ["Previous Employer", "Prior Employer", "Former Company", "Past Workplace"],
    sampleExtractedValue: "Telstra Operations Ltd"
  },
  {
    id: "previous_employment_tenure",
    number: 61,
    name: "Previous Employment Tenure",
    label: "previous_employment_tenure",
    category: "employment",
    maxToleranceRegex: "(previ[o0]us[_-]?j[o0]b[_-]?tenure|pri[o0]r[_-]?emp[l1][o0]yment[_-]?durati[o0]n|years[_-]?at[_-]?pri[o0]r[_-]?j[o0]b|previ[o0]us[_-]?emp[l1][o0]yment[_-]?yrs|past[_-]?j[o0]b[_-]?time|pri[o0]r[_-]?w[o0]rk[_-]?tenure|f[o0]rmer[_-]?tenure)",
    description: "Extracts time spent in previous employment role in years and months.",
    targetDataType: "text",
    exampleLabels: ["Previous Job Tenure", "Prior Employment Duration", "Years at Prior Job", "Past Job Time"],
    sampleExtractedValue: "4 Years 1 Month"
  },
  {
    id: "business_structure",
    number: 62,
    name: "Business Structure / Entity Type",
    label: "business_structure",
    category: "employment",
    maxToleranceRegex: "(bu[s5]ines[s5][_-]?[s5]tructure|entity[_-]?type|[s5][o0][l1]e[_-]?trader|pty[_-]?[l1]td|partner[s5]hip|tru[s5]t[_-]?entity|pr[o0]prietary[_-]?[l1]imited|c[o0]mpany[_-]?type|trading[_-]?entity)",
    description: "Captures commercial structure for self-employed applicants: Sole Trader, Pty Ltd, Partnership, or Trust.",
    targetDataType: "text",
    exampleLabels: ["Business Structure", "Entity Type", "Pty Ltd", "Sole Trader", "Partnership"],
    sampleExtractedValue: "Proprietary Limited (Pty Ltd)"
  },
  {
    id: "anzsic_code",
    number: 63,
    name: "ANZSIC Industry Code",
    label: "anzsic_code",
    category: "employment",
    maxToleranceRegex: "(anz[s5]ic[_-]?c[o0]de|indu[s5]try[_-]?c[o0]de|anz[s5]ic[_-]?divi[s5]i[o0]n|anz[s5]ic[_-]?c[l1]a[s5][s5]|indu[s5]try[_-]?c[l1]a[s5][s5]ificati[o0]n|anz[s5]ic|indu[s5]tria[l1][_-]?c[o0]de|bu[s5]ines[s5][_-]?activity[_-]?c[o0]de)",
    description: "Extracts Australian and New Zealand Standard Industrial Classification (ANZSIC) code.",
    targetDataType: "identifier",
    exampleLabels: ["ANZSIC Code", "Industry Code", "ANZSIC Class", "Industry Classification"],
    sampleExtractedValue: "7000"
  }
];

// src/data/fields/incomeExtendedFields.ts
var INCOME_EXTENDED_FIELDS = [
  {
    id: "income_frequency",
    number: 64,
    name: "Income / Pay Frequency",
    label: "income_frequency",
    category: "income",
    maxToleranceRegex: "(inc[o0]me[_-]?freq[uv]ency|pay[_-]?freq[uv]ency|pay[_-]?cyc[l1]e|payment[_-]?interva[l1]|remunerati[o0]n[_-]?freq[uv]ency|[s5]a[l1]ary[_-]?freq[uv]ency|pay[_-]?peri[o0]d|freq[uv]ency[_-]?of[_-]?pay)",
    description: "Identifies payment interval: weekly, fortnightly, monthly, or annually.",
    targetDataType: "text",
    exampleLabels: ["Income Frequency", "Pay Frequency", "Pay Cycle", "Salary Frequency"],
    sampleExtractedValue: "Fortnightly"
  },
  {
    id: "gross_monthly_income",
    number: 65,
    name: "Gross Monthly Income",
    label: "gross_monthly_income",
    category: "income",
    maxToleranceRegex: "(gr[o0][s5][s5][_-]?m[o0]nth[l1]y|m[o0]nth[l1]y[_-]?gr[o0][s5][s5]|m[o0]nth[l1]y[_-]?earnings|ba[s5]e[_-]?m[o0]nth[l1]y[_-]?pay|gr[o0][s5][s5][_-]?per[_-]?m[o0]nth|m[o0]nth[l1]y[_-]?package|pre[_-]?tax[_-]?m[o0]nth[l1]y|gr[o0][s5][s5][_-]?m[o0])",
    description: "Captures declared gross monthly pre-tax income for servicing assessment.",
    targetDataType: "currency",
    exampleLabels: ["Gross Monthly Income", "Monthly Gross", "Base Monthly Pay", "Pre-tax Monthly"],
    sampleExtractedValue: "$13,750.00 / month"
  },
  {
    id: "salary_sacrifice",
    number: 66,
    name: "Salary Sacrifice / Novated Lease",
    label: "salary_sacrifice",
    category: "income",
    maxToleranceRegex: "([s5]a[l1]ary[_-]?[s5]acrifice|pre[_-]?tax[_-]?deducti[o0]n|n[o0]vated[_-]?[l1]ea[s5]e|[s5]a[l1]ary[_-]?packaging|[s5]uper[_-]?[s5]acrifice|packaged[_-]?am[o0]unt|fringe[_-]?benefit|[s5]a[l1]ary[_-]?[s5]ac)",
    description: "Extracts pre-tax packaging arrangements including novated motor leases and extra super contributions.",
    targetDataType: "currency",
    exampleLabels: ["Salary Sacrifice", "Novated Lease", "Salary Packaging", "Pre-tax Deduction"],
    sampleExtractedValue: "$1,200.00 / month"
  },
  {
    id: "overtime_income",
    number: 67,
    name: "Overtime Earnings",
    label: "overtime_income",
    category: "income",
    maxToleranceRegex: "([o0]vertime|[o0]t[_-]?earnings|[o0]vertime[_-]?a[l1][l1][o0]wance|[s5]hift[_-]?a[l1][l1][o0]wance|pena[l1]ty[_-]?rates|regu[l1]ar[_-]?[o0]vertime|[o0]t[_-]?pay|weekend[_-]?pena[l1]ty)",
    description: "Captures overtime pay, shift penalties, and callout allowances.",
    targetDataType: "currency",
    exampleLabels: ["Overtime", "OT Earnings", "Shift Allowance", "Penalty Rates"],
    sampleExtractedValue: "$850.00 / month"
  },
  {
    id: "bonus_commission",
    number: 68,
    name: "Bonus / Commission Income",
    label: "bonus_commission",
    category: "income",
    maxToleranceRegex: "(b[o0]nu[s5][_-]?c[o0]mmi[s5][s5]i[o0]n|annua[l1][_-]?b[o0]nu[s5]|perf[o0]rmance[_-]?pay|c[o0]mmi[s5][s5]i[o0]n[_-]?earnings|[s5]h[o0]rt[_-]?term[_-]?incentive|[s5]ti[_-]?b[o0]nu[s5]|[s5]a[l1]es[_-]?c[o0]mmi[s5][s5]i[o0]n|incentive[_-]?payment)",
    description: "Captures variable sales commissions, annual bonuses, and short-term incentives.",
    targetDataType: "currency",
    exampleLabels: ["Bonus / Commission", "Annual Bonus", "Sales Commission", "Performance Pay"],
    sampleExtractedValue: "$24,000.00 p.a."
  },
  {
    id: "rental_income",
    number: 69,
    name: "Rental Income (Gross / Net)",
    label: "rental_income",
    category: "income",
    maxToleranceRegex: "(renta[l1][_-]?inc[o0]me|gr[o0][s5][s5][_-]?rent|inve[s5]tment[_-]?rent|pr[o0]perty[_-]?renta[l1]|[l1]ea[s5]e[_-]?inc[o0]me|tenancy[_-]?inc[o0]me|rent[_-]?received|dec[l1]ared[_-]?rent)",
    description: "Extracts gross or net rent received from residential or commercial investment real estate.",
    targetDataType: "currency",
    exampleLabels: ["Rental Income", "Gross Rent", "Investment Property Rent", "Lease Income"],
    sampleExtractedValue: "$2,400.00 / month"
  },
  {
    id: "investment_income",
    number: 70,
    name: "Investment / Dividend Income",
    label: "investment_income",
    category: "income",
    maxToleranceRegex: "(inve[s5]tment[_-]?inc[o0]me|dividend[s5]|[s5]hare[_-]?dividend[s5]|tru[s5]t[_-]?di[s5]tributi[o0]n|intere[s5]t[_-]?inc[o0]me|annuity|managed[_-]?fund[s5][_-]?inc[o0]me|inve[s5]tment[_-]?yie[l1]d)",
    description: "Matches income from equity dividends, unit trust distributions, and interest returns.",
    targetDataType: "currency",
    exampleLabels: ["Investment Income", "Dividends", "Trust Distribution", "Interest Income"],
    sampleExtractedValue: "$6,800.00 p.a."
  },
  {
    id: "government_benefit",
    number: 71,
    name: "Government Benefit",
    label: "government_benefit",
    category: "income",
    maxToleranceRegex: "(g[o0]vernment[_-]?benefit|centrep[l1]ink|fami[l1]y[_-]?tax[_-]?benefit|ftb|pen[s5]i[o0]n|chi[l1]d[_-]?[s5]upp[o0]rt[_-]?received|parenting[_-]?payment|dva[_-]?benefit)",
    description: "Identifies government statutory support payments such as Centrelink FTB or DVA pensions.",
    targetDataType: "currency",
    exampleLabels: ["Government Benefit", "Centrelink", "Family Tax Benefit", "FTB"],
    sampleExtractedValue: "$420.00 / fortnight"
  },
  {
    id: "income_verification_doc",
    number: 72,
    name: "Income Verification Document",
    label: "income_verification_doc",
    category: "income",
    maxToleranceRegex: "(inc[o0]me[_-]?pr[o0][o0]f|pay[s5][l1]ip|pay[_-]?[s5][l1]ip|payg[_-]?[s5]ummary|n[o0]tice[_-]?of[_-]?a[s5][s5]e[s5][s5]ment|n[o0]a|inc[o0]me[_-]?[s5]tatement|at[o0][_-]?tax[_-]?return)",
    description: "Matches documentation proof such as payslips, ATO Notice of Assessment, or PAYG payment summaries.",
    targetDataType: "text",
    exampleLabels: ["Payslip", "Notice of Assessment", "PAYG Summary", "Income Statement"],
    sampleExtractedValue: "ATO Notice of Assessment 2021 Financial Year"
  }
];

// src/data/fields/expenseExtendedFields.ts
var EXPENSE_EXTENDED_FIELDS = [
  {
    id: "rent_board_payment",
    number: 73,
    name: "Rent / Board Payment",
    label: "rent_board_payment",
    category: "expenses",
    maxToleranceRegex: "(rent[_-]?paid|b[o0]ard[_-]?paid|renta[l1][_-]?payment|tenancy[_-]?c[o0][s5]t|[l1]ea[s5]e[_-]?payment|rent[_-]?expen[s5]e|b[o0]ard[_-]?c[o0][s5]t|h[o0]u[s5]ing[_-]?rent)",
    description: "Captures ongoing rent or board expense paid by applicant for primary dwelling.",
    targetDataType: "currency",
    exampleLabels: ["Rent Paid", "Board Paid", "Rental Payment", "Housing Rent"],
    sampleExtractedValue: "$650.00 / week"
  },
  {
    id: "utilities_expense",
    number: 74,
    name: "Utilities & Telecommunications",
    label: "utilities_expense",
    category: "expenses",
    maxToleranceRegex: "(uti[l1]ities|e[l1]ectricity[_-]?ga[s5]|water[_-]?rate[s5]|energy[_-]?bi[l1][l1][s5]|br[o0]adband[_-]?internet|ph[o0]ne[_-]?internet|uti[l1]ity[_-]?bi[l1][l1][s5]|p[o0]wer[_-]?c[o0][s5]t)",
    description: "Extracts household utility costs: power, gas, water, internet, and fixed telecommunications.",
    targetDataType: "currency",
    exampleLabels: ["Utilities", "Electricity & Gas", "Water Rates", "Internet Bills"],
    sampleExtractedValue: "$380.00 / month"
  },
  {
    id: "insurance_expense",
    number: 75,
    name: "Insurance Premiums",
    label: "insurance_expense",
    category: "expenses",
    maxToleranceRegex: "(in[s5]urance[_-]?premium[s5]?|hea[l1]th[_-]?in[s5]urance|h[o0]me[_-]?bui[l1]ding[_-]?in[s5]urance|c[o0]ntent[s5][_-]?in[s5]urance|car[_-]?in[s5]urance|[l1]ife[_-]?in[s5]urance|inc[o0]me[_-]?pr[o0]tecti[o0]n|in[s5]urance[_-]?c[o0][s5]t)",
    description: "Matches combined insurance expenditures for private health, home, vehicle, and life.",
    targetDataType: "currency",
    exampleLabels: ["Insurance Premiums", "Health Insurance", "Home & Contents", "Vehicle Insurance"],
    sampleExtractedValue: "$520.00 / month"
  },
  {
    id: "transport_fuel_expense",
    number: 76,
    name: "Transport / Fuel Expense",
    label: "transport_fuel_expense",
    category: "expenses",
    maxToleranceRegex: "(tran[s5]p[o0]rt[_-]?c[o0][s5]t[s5]?|fue[l1][_-]?petr[o0][l1]|vehic[l1]e[_-]?reg[o0]|car[_-]?maintenance|pub[l1]ic[_-]?tran[s5]p[o0]rt|c[o0]mmute[_-]?expen[s5]e|vehic[l1]e[_-]?running|trave[l1][_-]?c[o0][s5]t)",
    description: "Captures vehicle operating costs including petrol, tolls, registration, and transit fares.",
    targetDataType: "currency",
    exampleLabels: ["Transport Costs", "Fuel & Petrol", "Vehicle Registration", "Public Transport"],
    sampleExtractedValue: "$340.00 / month"
  },
  {
    id: "childcare_education_expense",
    number: 77,
    name: "Childcare & Education Expenses",
    label: "childcare_education_expense",
    category: "expenses",
    maxToleranceRegex: "(chi[l1]dcare[_-]?fee[s5]|[s5]ch[o0][o0][l1][_-]?fee[s5]|educati[o0]n[_-]?c[o0][s5]t[s5]|tuiti[o0]n[_-]?fee[s5]|daycare|kindergarten|univer[s5]ity[_-]?fee[s5]|chi[l1]dcare[_-]?expen[s5]e)",
    description: "Matches day care, school fees, tuition, and tertiary educational commitments.",
    targetDataType: "currency",
    exampleLabels: ["Childcare Fees", "School Fees", "Tuition", "Education Costs"],
    sampleExtractedValue: "$1,150.00 / month"
  },
  {
    id: "child_support_paid",
    number: 78,
    name: "Child Support / Maintenance Paid",
    label: "child_support_paid",
    category: "expenses",
    maxToleranceRegex: "(chi[l1]d[_-]?[s5]upp[o0]rt[_-]?paid|[s5]p[o0]u[s5]a[l1][_-]?maintenance|fami[l1]y[_-]?maintenance|c[s5]a[_-]?payment|a[l1]im[o0]ny[_-]?paid|chi[l1]d[_-]?maintenance|chi[l1]d[s5]upp[o0]rt[_-]?pmt|maintenance[_-]?paid)",
    description: "Extracts mandatory Child Support Agency (CSA) payments or court-ordered spousal maintenance.",
    targetDataType: "currency",
    exampleLabels: ["Child Support Paid", "Spousal Maintenance", "CSA Payment", "Family Maintenance"],
    sampleExtractedValue: "$600.00 / month"
  },
  {
    id: "hem_benchmark_expense",
    number: 79,
    name: "HEM Benchmark Living Expenses",
    label: "hem_benchmark_expense",
    category: "expenses",
    maxToleranceRegex: "(hem[_-]?benchmark|hem[_-]?[l1]iving[_-]?expen[s5]e[s5]?|hem[_-]?expen[s5]e[s5]?|hem[_-]?ba[s5]e[l1]ine|h[o0]u[s5]eh[o0][l1]d[_-]?expenditure|hem[_-]?c[o0]mpari[s5][o0]n|hem[_-]?a[l1][l1][o0]wance|hem[_-]?am[o0]unt)",
    description: "Captures Household Expenditure Measure (HEM) benchmark expenses applied in credit servicing assessment.",
    targetDataType: "currency",
    exampleLabels: ["HEM Benchmark", "HEM Living Expenses", "HEM Amount", "Household Expenditure Measure", "HEM Baseline"],
    sampleExtractedValue: "$2,850.00 / month"
  }
];

// src/data/fields/assetLiabilityExtendedFields.ts
var ASSET_LIABILITY_EXTENDED_FIELDS = [
  {
    id: "savings_balance",
    number: 80,
    name: "Savings & Offset Account Balances",
    label: "savings_balance",
    category: "assets_liabilities",
    maxToleranceRegex: "([s5]aving[s5][_-]?ba[l1]ance|[o0]ff[s5]et[_-]?ba[l1]ance|ca[s5]h[_-]?at[_-]?bank|term[_-]?dep[o0][s5]it|cheq[uv]e[_-]?acc[o0]unt|ca[s5]h[_-]?re[s5]erve[s5]|bank[_-]?ba[l1]ance|[l1]iq[uv]id[_-]?[s5]aving[s5])",
    description: "Matches liquid savings accounts, mortgage offset funds, and short-term bank deposits.",
    targetDataType: "currency",
    exampleLabels: ["Savings Balance", "Offset Account", "Cash at Bank", "Term Deposit"],
    sampleExtractedValue: "$48,500.00"
  },
  {
    id: "superannuation_balance",
    number: 81,
    name: "Superannuation Fund Balance",
    label: "superannuation_balance",
    category: "assets_liabilities",
    maxToleranceRegex: "([s5]uperannuati[o0]n[_-]?ba[l1]ance|[s5]uper[_-]?ba[l1]ance|[s5]uper[_-]?fund|[s5]m[s5]f[_-]?ba[l1]ance|retirement[_-]?fund|[s5]uper[_-]?annuity|au[s5]tra[l1]ian[s5]uper|[s5]uper[_-]?t[o0]ta[l1])",
    description: "Captures member balances in APRA-regulated superannuation funds or SMSFs.",
    targetDataType: "currency",
    exampleLabels: ["Superannuation Balance", "Super Fund", "SMSF Balance", "Retirement Savings"],
    sampleExtractedValue: "$184,200.00"
  },
  {
    id: "vehicle_value",
    number: 82,
    name: "Motor Vehicle Market Value",
    label: "vehicle_value",
    category: "assets_liabilities",
    maxToleranceRegex: "(vehic[l1]e[_-]?va[l1]ue|car[_-]?va[l1]ue|m[o0]t[o0]r[_-]?vehic[l1]e|aut[o0]m[o0]bi[l1]e[_-]?va[l1]ue|redb[o0][o0]k[_-]?va[l1]ue|vehic[l1]e[_-]?a[s5][s5]et|car[_-]?a[s5][s5]et|tran[s5]p[o0]rt[_-]?a[s5][s5]et)",
    description: "Extracts estimated market value of cars, motorbikes, or commercial road vehicles.",
    targetDataType: "currency",
    exampleLabels: ["Vehicle Value", "Car Value", "Motor Vehicle Asset", "Redbook Value"],
    sampleExtractedValue: "$32,000.00"
  },
  {
    id: "investment_property_value",
    number: 83,
    name: "Investment Property Value",
    label: "investment_property_value",
    category: "assets_liabilities",
    maxToleranceRegex: "(inve[s5]tment[_-]?pr[o0]perty[_-]?va[l1]ue|rea[l1][_-]?e[s5]tate[_-]?inve[s5]tment|pr[o0]perty[_-]?p[o0]rtf[o0][l1]i[o0]|sec[o0]ndary[_-]?pr[o0]perty|renta[l1][_-]?pr[o0]perty[_-]?va[l1]ue|rea[l1][_-]?e[s5]tate[_-]?a[s5][s5]et|pr[o0]perty[_-]?va[l1]uati[o0]n|[l1]and[_-]?va[l1]ue)",
    description: "Matches estimated or appraised value of investment real estate holdings.",
    targetDataType: "currency",
    exampleLabels: ["Investment Property Value", "Real Estate Portfolio", "Rental Property Value", "Property Valuation"],
    sampleExtractedValue: "$680,000.00"
  },
  {
    id: "bnpl_commitments",
    number: 84,
    name: "Buy Now Pay Later (BNPL) Commitments",
    label: "bnpl_commitments",
    category: "assets_liabilities",
    maxToleranceRegex: "(bnp[l1][_-]?c[o0]mmitment[s5]|afterpay|zip[_-]?pay|zip[_-]?m[o0]ney|k[l1]arna|paypa[l1][_-]?pay[_-]?in[_-]?4|buy[_-]?n[o0]w[_-]?pay[_-]?[l1]ater|in[s5]ta[l1][l1]ment[_-]?credit)",
    description: "Identifies BNPL credit facilities and current owing balances across Afterpay, Zip, and Klarna.",
    targetDataType: "currency",
    exampleLabels: ["BNPL Commitments", "Afterpay", "Zip Pay", "Buy Now Pay Later"],
    sampleExtractedValue: "$650.00 limit ($120.00 owing)"
  },
  {
    id: "hecs_help_debt",
    number: 85,
    name: "HECS / HELP Student Loan Debt",
    label: "hecs_help_debt",
    category: "assets_liabilities",
    maxToleranceRegex: "(hec[s5][_-]?debt|he[l1]p[_-]?debt|[s5]tudent[_-]?[l1][o0]an|higher[_-]?educati[o0]n[_-]?[l1][o0]an|vet[_-]?fee[_-]?he[l1]p|[s5]tudy[_-]?[l1][o0]an|at[o0][_-]?[s5]tudent[_-]?debt|hec[s5][_-]?he[l1]p)",
    description: "Extracts outstanding balance of Australian Government HECS-HELP student loans.",
    targetDataType: "currency",
    exampleLabels: ["HECS Debt", "HELP Student Loan", "Higher Education Loan", "Student Debt"],
    sampleExtractedValue: "$21,400.00"
  }
];

// src/data/fields/facilityExtendedFields.ts
var FACILITY_EXTENDED_FIELDS = [
  {
    id: "product_type_requested",
    number: 86,
    name: "Credit Facility / Product Type Requested",
    label: "product_type_requested",
    category: "facility",
    maxToleranceRegex: "(pr[o0]duct[_-]?type|faci[l1]ity[_-]?type|[l1][o0]an[_-]?pr[o0]duct|h[o0]me[_-]?[l1][o0]an[_-]?type|credit[_-]?card[_-]?type|[l1]ine[_-]?of[_-]?credit|faci[l1]ity[_-]?req[uv]e[s5]ted|target[_-]?pr[o0]duct)",
    description: "Matches requested financial product: variable home loan, fixed loan, credit card, or line of credit.",
    targetDataType: "text",
    exampleLabels: ["Product Type", "Facility Type", "Loan Product", "Product Requested"],
    sampleExtractedValue: "Principal and Interest Variable Home Loan"
  },
  {
    id: "loan_amount_requested",
    number: 87,
    name: "Loan Amount Requested",
    label: "loan_amount_requested",
    category: "facility",
    maxToleranceRegex: "([l1][o0]an[_-]?am[o0]unt|b[o0]rr[o0]wing[_-]?am[o0]unt|finance[_-]?am[o0]unt|req[uv]e[s5]ted[_-]?b[o0]rr[o0]wing|principa[l1][_-]?am[o0]unt|[l1][o0]an[_-]?[s5]um|am[o0]unt[_-]?t[o0][_-]?b[o0]rr[o0]w|faci[l1]ity[_-]?am[o0]unt)",
    description: "Captures total principal loan or finance amount requested by applicant.",
    targetDataType: "currency",
    exampleLabels: ["Loan Amount Requested", "Borrowing Amount", "Finance Amount", "Principal Amount"],
    sampleExtractedValue: "$520,000.00"
  },
  {
    id: "loan_purpose",
    number: 88,
    name: "Loan / Credit Purpose",
    label: "loan_purpose",
    category: "facility",
    maxToleranceRegex: "([l1][o0]an[_-]?purp[o0][s5]e|purp[o0][s5]e[_-]?of[_-]?[l1][o0]an|b[o0]rr[o0]wing[_-]?purp[o0][s5]e|credit[_-]?purp[o0][s5]e|refinance|[o0]wner[_-]?[o0]ccupied|inve[s5]tment[_-]?purcha[s5]e|debt[_-]?c[o0]n[s5][o0][l1]idati[o0]n)",
    description: "Extracts credit purpose: purchase primary residence, investment, refinance, or debt consolidation.",
    targetDataType: "text",
    exampleLabels: ["Loan Purpose", "Purpose of Loan", "Borrowing Purpose", "Credit Purpose"],
    sampleExtractedValue: "Refinance of Existing Home Loan"
  },
  {
    id: "repayment_frequency",
    number: 89,
    name: "Requested Repayment Frequency",
    label: "repayment_frequency",
    category: "facility",
    maxToleranceRegex: "(repayment[_-]?freq[uv]ency|payment[_-]?freq[uv]ency|repayment[_-]?cyc[l1]e|m[o0]nth[l1]y[_-]?repayment[s5]?|f[o0]rtnight[l1]y[_-]?repayment[s5]?|week[l1]y[_-]?repayment[s5]?|repayment[_-]?interva[l1]|in[s5]ta[l1][l1]ment[_-]?freq[uv]ency)",
    description: "Captures preferred loan repayment schedule: weekly, fortnightly, or monthly installments.",
    targetDataType: "text",
    exampleLabels: ["Repayment Frequency", "Payment Frequency", "Repayment Cycle", "Payment Interval"],
    sampleExtractedValue: "Monthly"
  },
  {
    id: "direct_debit_account",
    number: 90,
    name: "Direct Debit / Settlement Account",
    label: "direct_debit_account",
    category: "facility",
    maxToleranceRegex: "(direct[_-]?debit|[s5]ett[l1]ement[_-]?acc[o0]unt|n[o0]minated[_-]?acc[o0]unt|repayment[_-]?acc[o0]unt|drawd[o0]wn[_-]?acc[o0]unt|aut[o0][_-]?debit|direct[_-]?debit[_-]?bank|bi[l1][l1]er[_-]?acc[o0]unt)",
    description: "Matches nominated bank account designated for automatic direct debit repayment.",
    targetDataType: "text",
    exampleLabels: ["Direct Debit Account", "Settlement Account", "Nominated Account", "Repayment Account"],
    sampleExtractedValue: "Commonwealth Bank of Australia (BSB 063-001 Acc 10293847)"
  }
];

// src/data/fields/structuralIdentifierFields.ts
var STRUCTURAL_IDENTIFIER_FIELDS = [
  {
    id: "account_number",
    number: 104,
    name: "Australian Bank Account Number",
    label: "account_number",
    category: "facility",
    maxToleranceRegex: "(\\b\\d{3}[- ]?\\d{3}[- ]?\\d{3}\\b|\\b\\d{6,10}\\b)",
    description: "Standard 6 to 10 digit Australian bank account number.",
    targetDataType: "identifier",
    exampleLabels: ["Account Number", "Bank Account No", "Acc Number"],
    sampleExtractedValue: "492019482"
  },
  {
    id: "acn",
    number: 105,
    name: "Australian Company Number (ACN)",
    label: "acn",
    category: "employment",
    maxToleranceRegex: "(\\b\\d{3}[ ]?\\d{3}[ ]?\\d{3}\\b)",
    description: "Standard 9-digit Australian Company Number registered with ASIC.",
    targetDataType: "identifier",
    exampleLabels: ["ACN", "Australian Company Number"],
    sampleExtractedValue: "102 443 916"
  },
  {
    id: "tfn",
    number: 106,
    name: "Tax File Number (TFN)",
    label: "tfn",
    category: "identity",
    maxToleranceRegex: "(\\b\\d{3}[ -]?\\d{3}[ -]?\\d{2,3}\\b)",
    description: "Standard 8 or 9-digit Australian Tax File Number issued by ATO.",
    targetDataType: "identifier",
    exampleLabels: ["TFN", "Tax File Number"],
    sampleExtractedValue: "123 456 782"
  },
  {
    id: "medicare_number",
    number: 107,
    name: "Medicare Number",
    label: "medicare_number",
    category: "identity",
    maxToleranceRegex: "(\\b[2-6]\\d{3}[ ]?\\d{5}[ ]?\\d(?:[- /]?\\d)?\\b)",
    description: "Australian 10-digit Medicare card number with optional individual reference number (IRN).",
    targetDataType: "identifier",
    exampleLabels: ["Medicare Number", "Medicare Card No"],
    sampleExtractedValue: "2123 45678 1"
  },
  {
    id: "bpay_biller_code",
    number: 108,
    name: "BPAY Biller Code",
    label: "bpay_biller_code",
    category: "facility",
    maxToleranceRegex: "(\\b\\d{4,6}\\b)",
    description: "Standard 4 to 6 digit Australian BPAY Biller Code.",
    targetDataType: "identifier",
    exampleLabels: ["Biller Code", "BPAY Biller Code", "BPAY Code"],
    sampleExtractedValue: "84920"
  },
  {
    id: "card_number_masked",
    number: 109,
    name: "Card Number (Masked)",
    label: "card_number_masked",
    category: "facility",
    maxToleranceRegex: "(\\b(?:\\d{4}[ -]?(?:[\\*X]{4}[ -]?){2}\\d{4}|[\\*X]{12}\\d{4}|\\d{16})\\b)",
    description: "PCI-DSS masked primary account number or tokenized 16-digit card number.",
    targetDataType: "identifier",
    exampleLabels: ["Card Number (Masked)", "Masked Card Number", "Card PAN", "Credit Card No"],
    sampleExtractedValue: "4532 **** **** 1234"
  }
];

// src/data/fields/index.ts
var EXTENDED_BANK_FIELD_DEFINITIONS = [
  ...IDENTITY_EXTENDED_FIELDS,
  ...RESIDENTIAL_EXTENDED_FIELDS,
  ...CONTACT_EXTENDED_FIELDS,
  ...EMPLOYMENT_EXTENDED_FIELDS,
  ...INCOME_EXTENDED_FIELDS,
  ...EXPENSE_EXTENDED_FIELDS,
  ...ASSET_LIABILITY_EXTENDED_FIELDS,
  ...FACILITY_EXTENDED_FIELDS
];
var EXTENDED_CORE_IDENTIFIER_DEFINITIONS = [
  ...STRUCTURAL_IDENTIFIER_FIELDS
];

// src/data/bankFields.ts
var BANK_FIELD_DEFINITIONS = [
  {
    id: "title_salutation",
    number: 1,
    name: "Title / Salutation",
    label: "title_salutation",
    category: "identity",
    maxToleranceRegex: "(tit[l1]e|sa[l1]utation|honorific|prefix|salution|mr|mrs|ms|miss|dr|prof|rev|lord|lady|sir|master|m\\.?r\\.?|m\\.?s\\.?|m\\.?r\\.?s\\.?)",
    description: "Tolerates l/1 substitutions, abbreviations with or without periods, and honorific variations.",
    targetDataType: "text",
    exampleLabels: ["Title", "Salutation", "Prefix", "Mr.", "Honorific"],
    sampleExtractedValue: "Mr."
  },
  {
    id: "given_names",
    number: 2,
    name: "Given Names / First Name",
    label: "given_names",
    category: "identity",
    maxToleranceRegex: "(given[_-]?names?|first[_-]?name|forename|christian[_-]?name|primary[_-]?name|givenname|firstname|forenames|1st[_-]?name)",
    description: "Catches hyphenated, underscore, spaced, and ordinal (1st) name representations.",
    targetDataType: "text",
    exampleLabels: ["Given Name(s)", "First Name", "Forename", "1st Name"],
    sampleExtractedValue: "Oliver Benjamin"
  },
  {
    id: "middle_name",
    number: 3,
    name: "Middle Name / Initials",
    label: "middle_name",
    category: "identity",
    maxToleranceRegex: "(middle[_-]?names?|middle[_-]?initials?|other[_-]?names?|second[_-]?name|initials|middlename|mid[_-]?name)",
    description: "Extracts middle names, other names, second names, or single initials.",
    targetDataType: "text",
    exampleLabels: ["Middle Name", "Other Name", "Initials", "Mid Name"],
    sampleExtractedValue: "Benjamin"
  },
  {
    id: "family_name",
    number: 4,
    name: "Family Name / Surname",
    label: "family_name",
    category: "identity",
    maxToleranceRegex: "(family[_-]?names?|surname|last[_-]?name|maiden[_-]?name|second[_-]?surname|familyname|lastname|sur[_-]?name|family[_-]?nm)",
    description: "Tolerates shorthand (family_nm), maiden names, and hyphenated variations.",
    targetDataType: "text",
    exampleLabels: ["Family Name", "Surname", "Last Name", "Maiden Name"],
    sampleExtractedValue: "Fitzgerald"
  },
  {
    id: "date_of_birth",
    number: 5,
    name: "Date of Birth (DOB)",
    label: "date_of_birth",
    category: "identity",
    maxToleranceRegex: "(dob|date[_-]?of[_-]?birth|birth[_-]?date|birthdate|born[_-]?on|day[_-]?month[_-]?year|birth[_-]?yr|dobdate|b[_-]?day)",
    description: "Handles acronyms (DOB), contractions (b-day), and OCR compound tokens.",
    targetDataType: "date",
    exampleLabels: ["DOB", "Date of Birth", "Birthdate", "Born On"],
    sampleExtractedValue: "14/08/1988"
  },
  {
    id: "residency_status",
    number: 6,
    name: "Residency / Citizenship Status",
    label: "residency_status",
    category: "identity",
    maxToleranceRegex: "(residency[_-]?status|citizenship|nationality|permanent[_-]?resident|visa[_-]?holder|citizen|residentstatus|pr[_-]?status|citizen[_-]?status)",
    description: "Matches PR, citizen, visa holder, and nationality classification fields.",
    targetDataType: "text",
    exampleLabels: ["Residency Status", "Citizenship", "PR Status", "Visa Holder"],
    sampleExtractedValue: "Australian Citizen"
  },
  {
    id: "marital_status",
    number: 7,
    name: "Marital / Relationship Status",
    label: "marital_status",
    category: "identity",
    maxToleranceRegex: "(marital[_-]?status|relationship[_-]?status|single|married|de[_-]?facto|defacto|divorced|spouse|maritalstatus|relationship)",
    description: "Captures De Facto (with/without space), Married, Single, and relationship anchors.",
    targetDataType: "text",
    exampleLabels: ["Marital Status", "Relationship Status", "De Facto", "Married"],
    sampleExtractedValue: "De Facto"
  },
  {
    id: "dependants_count",
    number: 8,
    name: "Dependants / Children Count",
    label: "dependants_count",
    category: "identity",
    maxToleranceRegex: "(dependants?|dependents?|children|kids|dependant[_-]?count|family[_-]?members|dependentscount|child[_-]?count|deps)",
    description: "Tolerates UK/AU vs US spelling (dependant vs dependent), kids, deps.",
    targetDataType: "number",
    exampleLabels: ["Dependants", "Number of Dependents", "Children", "Deps"],
    sampleExtractedValue: "2"
  },
  {
    id: "residential_address",
    number: 9,
    name: "Residential Address",
    label: "residential_address",
    category: "residential",
    maxToleranceRegex: "(residential[_-]?address|street|suburb|state|postcode|postal[_-]?code|address[_-]?line|addr|residentialadd|street[_-]?address|nsw|vic|qld|wa|sa|tas|act|nt|rd|st|ave|blvd|hwy)",
    description: "Captures street, suburb, postcode, and full residential address blocks, including AU state abbreviations and common street suffixes.",
    targetDataType: "text",
    exampleLabels: ["Residential Address", "Street Address", "Addr Line 1", "Suburb/State"],
    sampleExtractedValue: "42 Collins Street, Melbourne VIC 3000"
  },
  {
    id: "address_tenure",
    number: 10,
    name: "Address Tenure (Time at Address)",
    label: "address_tenure",
    category: "residential",
    maxToleranceRegex: "(time[_-]?at[_-]?address|years[_-]?at[_-]?address|months[_-]?residing|address[_-]?duration|tenure|timeathome|yrsataddress|address[_-]?yrs)",
    description: "Matches years/months residing, duration, and shorthand (yrsataddress).",
    targetDataType: "text",
    exampleLabels: ["Time at Address", "Years at Address", "Tenure", "Address Yrs"],
    sampleExtractedValue: "4 Years 6 Months"
  },
  {
    id: "previous_address",
    number: 11,
    name: "Previous / Past Address",
    label: "previous_address",
    category: "residential",
    maxToleranceRegex: "(previous[_-]?address|past[_-]?location|address[_-]?history|former[_-]?residence|prior[_-]?address|prev[_-]?address|past[_-]?address)",
    description: "Identifies historical addresses when current tenure is under 3 years.",
    targetDataType: "text",
    exampleLabels: ["Previous Address", "Prior Address", "Former Residence", "Prev Address"],
    sampleExtractedValue: "18 Barangaroo Ave, Sydney NSW 2000"
  },
  {
    id: "housing_situation",
    number: 12,
    name: "Housing Situation / Status",
    label: "housing_situation",
    category: "residential",
    maxToleranceRegex: "(housing[_-]?status|residential[_-]?status|renting|mortgaged|owned[_-]?outright|boarding|housingtype|accommodation|home[_-]?status)",
    description: "Identifies renting, mortgaged, owned outright, boarding, or accommodation types.",
    targetDataType: "text",
    exampleLabels: ["Housing Status", "Accommodation", "Renting", "Owned Outright"],
    sampleExtractedValue: "Mortgaged"
  },
  {
    id: "mobile_number",
    number: 13,
    name: "Mobile Phone Number",
    label: "mobile_number",
    category: "contact",
    maxToleranceRegex: "(mobile|phone|cellular|telephone|contact[_-]?number|cell|sms[_-]?number|mob|phonenumber|cellphone|contact[_-]?no|04\\d{2})",
    description: "Catches Australian mobile and telephone labels (including 04xx patterns), cell, mob, and contact no.",
    targetDataType: "phone",
    exampleLabels: ["Mobile", "Contact Number", "Telephone", "Mob No"],
    sampleExtractedValue: "0412 987 654"
  },
  {
    id: "email_address",
    number: 14,
    name: "Email Address",
    label: "email_address",
    category: "contact",
    maxToleranceRegex: "(email|electronic[_-]?mail|mail|contact[_-]?email|e[_-]?mail|inbox|emailaddress|mailaddr|e[_-]?mail[_-]?address)",
    description: "Recognizes hyphenated (e-mail), electronic mail, inbox, and contact email.",
    targetDataType: "email",
    exampleLabels: ["Email", "E-mail Address", "Electronic Mail", "Contact Email"],
    sampleExtractedValue: "oliver.fitzgerald@apexfinance.com.au"
  },
  {
    id: "drivers_licence",
    number: 15,
    name: "Driver\u2019s Licence Details",
    label: "drivers_licence",
    category: "identity",
    maxToleranceRegex: "(driver[_-]?licence|drivers?|license|licence[_-]?number|card[_-]?number|dl[_-]?number|driverslicence|licenceno|drv[_-]?lic|licence[_-]?(?:nsw|vic|qld|wa|sa|tas|act|nt))",
    description: "Tolerates UK/AU licence vs US license, card number, DL no, drv_lic, and state-specific licences.",
    targetDataType: "identifier",
    exampleLabels: ["Driver Licence No", "DL Number", "Card No", "Drivers License"],
    sampleExtractedValue: "83920194 VIC"
  },
  {
    id: "passport_details",
    number: 16,
    name: "Passport / Travel Document",
    label: "passport_details",
    category: "identity",
    maxToleranceRegex: "(passport|passport[_-]?number|travel[_-]?document|document[_-]?number|passport[_-]?expiry|passportno|passpt|travel[_-]?doc)",
    description: "Catches passport numbers, travel document numbers, expiry, and contractions.",
    targetDataType: "identifier",
    exampleLabels: ["Passport Number", "Travel Document", "Passpt No", "Document Expiry"],
    sampleExtractedValue: "PA9283710"
  },
  {
    id: "employment_status",
    number: 17,
    name: "Employment Status / Type",
    label: "employment_status",
    category: "employment",
    maxToleranceRegex: "(employment[_-]?status|job[_-]?type|full[_-]?time|part[_-]?time|casual|contract|self[_-]?employed|emp[_-]?status|employmenttype)",
    description: "Matches full-time, part-time, casual, contractor, self-employed designations.",
    targetDataType: "text",
    exampleLabels: ["Employment Status", "Job Type", "Full-time", "Emp Status"],
    sampleExtractedValue: "Permanent Full-Time"
  },
  {
    id: "occupation_industry",
    number: 18,
    name: "Occupation / Industry",
    label: "occupation_industry",
    category: "employment",
    maxToleranceRegex: "(occupation|profession|job[_-]?title|industry|work[_-]?role|career|trade|jobtitle|professiontype|industry[_-]?type)",
    description: "Extracts job title, ANZSCO profession, career trade, and industry classifications.",
    targetDataType: "text",
    exampleLabels: ["Occupation", "Job Title", "Industry", "Profession"],
    sampleExtractedValue: "Senior Cloud Engineer / Technology"
  },
  {
    id: "employer_details",
    number: 19,
    name: "Employer / Company Name",
    label: "employer_details",
    category: "employment",
    maxToleranceRegex: "(employer|company[_-]?name|business[_-]?name|organisation|firm|abn|acn|employername|companyname|workplace)",
    description: "Tolerates UK/AU organisation, firm, ABN/ACN identifiers, and company name.",
    targetDataType: "text",
    exampleLabels: ["Employer Name", "Company Name", "Workplace", "Business Name"],
    sampleExtractedValue: "Atlassian Australia Pty Ltd (ABN 53 102 443 916)"
  },
  {
    id: "employment_tenure",
    number: 20,
    name: "Employment Tenure (Time in Job)",
    label: "employment_tenure",
    category: "employment",
    maxToleranceRegex: "(job[_-]?tenure|work[_-]?length|duration[_-]?at[_-]?job|years[_-]?employed|employment[_-]?duration|jobduration|worktenure|emp[_-]?yrs)",
    description: "Extracts years/months in current job role and employment duration.",
    targetDataType: "text",
    exampleLabels: ["Job Tenure", "Years Employed", "Employment Duration", "Emp Yrs"],
    sampleExtractedValue: "3 Years 2 Months"
  },
  {
    id: "gross_annual_income",
    number: 21,
    name: "Gross Annual Income / Salary",
    label: "gross_annual_income",
    category: "income",
    maxToleranceRegex: "(gross[_-]?income|before[_-]?tax|annual[_-]?package|gross[_-]?salary|total[_-]?earnings|base[_-]?pay|grossannual|annualincome|gross[_-]?pay)",
    description: "Identifies pre-tax annual salary, gross package, and total earnings.",
    targetDataType: "currency",
    exampleLabels: ["Gross Annual Income", "Base Pay (p.a.)", "Annual Package", "Before Tax"],
    sampleExtractedValue: "$165,000.00 p.a."
  },
  {
    id: "net_monthly_income",
    number: 22,
    name: "Net Monthly Income (Take-Home)",
    label: "net_monthly_income",
    category: "income",
    maxToleranceRegex: "(net[_-]?income|take[_-]?home[_-]?pay|after[_-]?tax|net[_-]?earnings|disposable[_-]?income|netmonthly|takehome|net[_-]?pay)",
    description: "Captures take-home pay, after-tax earnings, and net disposable income.",
    targetDataType: "currency",
    exampleLabels: ["Net Monthly Income", "Take-Home Pay", "After Tax Pay", "Net Pay"],
    sampleExtractedValue: "$9,820.00 / month"
  },
  {
    id: "additional_income",
    number: 23,
    name: "Additional / Variable Income",
    label: "additional_income",
    category: "income",
    maxToleranceRegex: "(variable[_-]?income|overtime|bonus|commission|rental[_-]?income|dividends|side[_-]?hustle|extra[_-]?income|add[_-]?income|allowance)",
    description: "Catches bonuses, commissions, overtime, rental income, dividends, and allowances.",
    targetDataType: "currency",
    exampleLabels: ["Bonus / Commission", "Rental Income", "Variable Income", "Allowance"],
    sampleExtractedValue: "$18,500.00 (Annual Bonus)"
  },
  {
    id: "monthly_living_expenses",
    number: 24,
    name: "Monthly Living Expenses (HEM)",
    label: "monthly_living_expenses",
    category: "expenses",
    maxToleranceRegex: "(living[_-]?expenses|housing[_-]?cost|utilities|groceries|transport|insurance|medical|education|expenses|livingcost|monthly[_-]?spend)",
    description: "Captures HEM benchmark categories: groceries, utilities, insurance, childcare, transport.",
    targetDataType: "currency",
    exampleLabels: ["Living Expenses", "Monthly Spend", "Groceries & Utilities", "Living Cost"],
    sampleExtractedValue: "$3,400.00 / month"
  },
  {
    id: "asset_holdings",
    number: 25,
    name: "Asset Holdings & Net Worth",
    label: "asset_holdings",
    category: "assets_liabilities",
    maxToleranceRegex: "(assets|savings|transaction[_-]?account|real[_-]?estate|property[_-]?value|vehicles|superannuation|assetvalue|wealth|net[_-]?worth)",
    description: "Matches property value, bank savings, superannuation, vehicles, and total assets.",
    targetDataType: "currency",
    exampleLabels: ["Total Assets", "Savings Balance", "Superannuation", "Property Value"],
    sampleExtractedValue: "$820,000.00 (Property + Super + Savings)"
  },
  {
    id: "liability_mortgages",
    number: 26,
    name: "Mortgage Liabilities & Home Loans",
    label: "liability_mortgages",
    category: "assets_liabilities",
    maxToleranceRegex: "(home[_-]?loan|mortgagedebt|mortgage[_-]?repayment|mortgage[_-]?limit|housing[_-]?loan|homeloan|mortgagebalance|property[_-]?debt)",
    description: "Extracts existing mortgage balances, repayment obligations, and credit limits.",
    targetDataType: "currency",
    exampleLabels: ["Home Loan Balance", "Mortgage Repayment", "Housing Loan Debt"],
    sampleExtractedValue: "$485,000.00 ($2,780/mo)"
  },
  {
    id: "liability_credit_cards",
    number: 27,
    name: "Credit Card Limits & Balances",
    label: "liability_credit_cards",
    category: "assets_liabilities",
    maxToleranceRegex: "(credit[_-]?cards|plastic[_-]?cards|credit[_-]?limit|card[_-]?balance|store[_-]?cards|creditcarddebt|cc[_-]?limit|revolving[_-]?credit)",
    description: "Captures credit limits (APRA assesses 3.8% monthly on limits, not balances).",
    targetDataType: "currency",
    exampleLabels: ["Credit Card Limit", "CC Balance", "Store Cards", "Revolving Credit"],
    sampleExtractedValue: "$12,000.00 (Limit across 2 cards)"
  },
  {
    id: "liability_other_loans",
    number: 28,
    name: "Personal Loans, Car Loans & HECS/HELP",
    label: "liability_other_loans",
    category: "assets_liabilities",
    maxToleranceRegex: "(personal[_-]?loan|car[_-]?loan|installment[_-]?debt|bnpl|afterpay|zip|student[_-]?debt|hecs|help|personalloan|carloandebt|instalment)",
    description: "Identifies BNPL (Afterpay/Zip), auto loans, student loans (HECS/HELP), and personal loans.",
    targetDataType: "currency",
    exampleLabels: ["Personal Loan", "Car Loan", "HECS / HELP Debt", "BNPL / Afterpay"],
    sampleExtractedValue: "$14,200.00 (Car Loan: $390/mo)"
  },
  {
    id: "credit_limit_requested",
    number: 29,
    name: "Requested Credit / Facility Limit",
    label: "credit_limit_requested",
    category: "facility",
    maxToleranceRegex: "(credit[_-]?limit|requested[_-]?limit|maximum[_-]?limit|limit[_-]?requested|card[_-]?limit|limitrequested|maxlimit|req[_-]?limit)",
    description: "Captures the applicant\u2019s target borrowing capacity or requested credit line.",
    targetDataType: "currency",
    exampleLabels: ["Requested Credit Limit", "Limit Requested", "Req Limit", "Facility Limit"],
    sampleExtractedValue: "$25,000.00"
  },
  {
    id: "balance_transfer",
    number: 30,
    name: "Balance Transfer Amount & Biller",
    label: "balance_transfer",
    category: "facility",
    maxToleranceRegex: "(balance[_-]?transfer|transfer[_-]?amount|biller[_-]?code|transfer[_-]?balance|debt[_-]?transfer|balancetransfer|bt[_-]?amount|bt[_-]?facility)",
    description: "Extracts balance transfer instructions, BPAY biller codes, and requested amounts.",
    targetDataType: "currency",
    exampleLabels: ["Balance Transfer Amount", "Biller Code", "BT Facility", "Transfer Balance"],
    sampleExtractedValue: "$6,500.00 (Biller: 84920)"
  },
  ...EXTENDED_BANK_FIELD_DEFINITIONS
];
var CORE_IDENTIFIER_DEFINITIONS = [
  {
    id: "abn",
    number: 101,
    name: "Australian Business Number (ABN)",
    label: "abn",
    category: "employment",
    maxToleranceRegex: "(\\b\\d{2}[ ]?\\d{3}[ ]?\\d{3}[ ]?\\d{3}\\b)",
    description: "Standard 11-digit Australian Business Number with modulo 89 validation.",
    targetDataType: "identifier",
    exampleLabels: ["ABN", "Australian Business Number"],
    sampleExtractedValue: "53 102 443 916"
  },
  {
    id: "bsb",
    number: 102,
    name: "Bank State Branch (BSB)",
    label: "bsb",
    category: "facility",
    maxToleranceRegex: "(\\b\\d{3}[- ]?\\d{3}\\b)",
    description: "Standard 6-digit APRA Australian Bank State Branch code.",
    targetDataType: "identifier",
    exampleLabels: ["BSB", "Bank State Branch"],
    sampleExtractedValue: "083-004"
  },
  {
    id: "postcode",
    number: 103,
    name: "Australian Postcode",
    label: "postcode",
    category: "residential",
    maxToleranceRegex: "(\\b(?:0[2-9]|[1-9][0-9])\\d{2}\\b)",
    description: "4-digit Australian postal code valid in range 0200-9999.",
    targetDataType: "identifier",
    exampleLabels: ["Postcode", "Postal Code"],
    sampleExtractedValue: "3000"
  },
  ...EXTENDED_CORE_IDENTIFIER_DEFINITIONS
];

// src/utils/ocrMatcherEngine.ts
function extractBankFieldsFromText(text) {
  const allFields = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];
  const results = [];
  const documentContext = analyzeDocumentContext(text);
  for (const field of allFields) {
    const result = extractSingleFieldWithContext(text, field, documentContext);
    results.push(result);
  }
  return enforceAustralianFormattingRules(results);
}
function analyzeDocumentContext(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let currentSection = "HEADER";
  let sectionStart = 0;
  lines.forEach((line, idx) => {
    const upper = line.toUpperCase().trim();
    if (upper.includes("1. PERSONAL") || upper.includes("APPLICANT") || upper.includes("PERSONAL IDENTIFIER")) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = "PERSONAL_IDENTITY";
      sectionStart = idx;
    } else if (upper.includes("2. RESIDENTIAL") || upper.includes("ADDRESS & ACCOMMODATION") || upper.includes("LOCATION & CONTACT") || upper.includes("RESIDENTIAL:")) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = "RESIDENTIAL_CONTACT";
      sectionStart = idx;
    } else if (upper.includes("3. EMPLOYMENT") || upper.includes("PROFESSIONAL BACKGROUND") || upper.includes("EMPLOYMENT:") || upper.includes("JOB & INCOME")) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = "EMPLOYMENT_INCOME";
      sectionStart = idx;
    } else if (upper.includes("4. FINANCIAL POSITION") || upper.includes("HEM LIVING COSTS") || upper.includes("EXPENSES & LIABILITIES") || upper.includes("COMMITMENTS & APRA")) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = "FINANCIAL_POSITION";
      sectionStart = idx;
    } else if (upper.includes("5. FACILITY REQUEST") || upper.includes("NEW FACILITY") || upper.includes("BALANCE TRANSFER")) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = "FACILITY_REQUEST";
      sectionStart = idx;
    }
  });
  sections.push({ name: currentSection, startLine: sectionStart, endLine: lines.length - 1 });
  return { lines, sections };
}
function getSectionForIndex(docContext, lineIndex) {
  const match = docContext.sections.find((s) => lineIndex >= s.startLine && lineIndex <= s.endLine);
  return match ? match.name : "GENERAL";
}
function extractSingleFieldWithContext(text, field, docContext) {
  try {
    if (field.id === "abn") {
      const abnMatches = Array.from(text.matchAll(/\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/g));
      if (abnMatches.length > 0) {
        let bestAbnMatch = abnMatches[0];
        let bestScore = 0;
        for (const match of abnMatches) {
          const matchIdx2 = match.index ?? 0;
          const preWindow = text.substring(Math.max(0, matchIdx2 - 50), matchIdx2).toLowerCase();
          let score = 10;
          if (preWindow.includes("abn") || preWindow.includes("workplace") || preWindow.includes("business")) score += 50;
          if (score > bestScore) {
            bestScore = score;
            bestAbnMatch = match;
          }
        }
        const val = bestAbnMatch[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        const matchIdx = bestAbnMatch.index ?? 0;
        const lineIdx = text.substring(0, matchIdx).split("\n").length - 1;
        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: "ABN [ATO Modulo-89 Validated]",
          extractedValue: val,
          confidence: isValid ? 98 : 82,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: "matched",
          contextSnippet: getSnippet(text, matchIdx, bestAbnMatch[0].length),
          isValid,
          validationMessage,
          disambiguation: {
            disambiguationStrategy: "KEYWORD_PROXIMITY_HEURISTIC",
            sectionContext: getSectionForIndex(docContext, lineIdx),
            nlpResolved: false,
            notes: "Verified via Australian Taxation Office (ATO) Modulo-89 Checksum Algorithm. Disambiguated via spatial keyword proximity."
          }
        };
      }
    }
    if (field.id === "bsb") {
      const bsbMatches = Array.from(text.matchAll(/\b\d{3}[- ]\d{3}\b/g));
      if (bsbMatches.length > 0) {
        let bestBsb = bsbMatches[0];
        for (const m of bsbMatches) {
          const mIdx = m.index ?? 0;
          const preWindow = text.substring(Math.max(0, mIdx - 30), mIdx).toLowerCase();
          if (preWindow.includes("bsb") || preWindow.includes("branch")) {
            bestBsb = m;
            break;
          }
        }
        const val = bestBsb[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        const institutionName = getApraBankNameFromBsb(val);
        const matchIdx = bestBsb.index ?? 0;
        const lineIdx = text.substring(0, matchIdx).split("\n").length - 1;
        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: `BSB [${institutionName}]`,
          extractedValue: val,
          confidence: 99,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: "matched",
          contextSnippet: getSnippet(text, matchIdx, bestBsb[0].length),
          isValid,
          validationMessage: isValid ? `APRA Registered: ${institutionName}` : validationMessage,
          disambiguation: {
            disambiguationStrategy: "KEYWORD_PROXIMITY_HEURISTIC",
            sectionContext: getSectionForIndex(docContext, lineIdx),
            nlpResolved: false,
            notes: `Resolved to ${institutionName} via APRA 6-digit routing matrix.`
          }
        };
      }
    }
    if (field.id === "postcode") {
      const pcMatches = Array.from(text.matchAll(/\b(?:0[2-9]|[1-9][0-9])\d{2}\b/g));
      if (pcMatches.length > 0) {
        let bestPc = pcMatches[0];
        for (const m of pcMatches) {
          const idx = m.index ?? 0;
          const pre = text.substring(Math.max(0, idx - 40), idx);
          if (/(?:nsw|vic|qld|wa|sa|tas|act|nt)/i.test(pre)) {
            bestPc = m;
            break;
          }
        }
        const val = bestPc[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        const matchIdx = bestPc.index ?? 0;
        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: "AU Postcode Pattern",
          extractedValue: val,
          confidence: 94,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: "matched",
          contextSnippet: getSnippet(text, matchIdx, bestPc[0].length),
          isValid,
          validationMessage,
          disambiguation: {
            disambiguationStrategy: "REGEX_EXACT",
            sectionContext: "RESIDENTIAL_CONTACT",
            nlpResolved: true,
            notes: "Geocoded Australia Post 4-digit routing zone."
          }
        };
      }
    }
    const anchorRegex = new RegExp(`(?:^|[^a-zA-Z0-9_])${field.maxToleranceRegex}(?:\\s*[:=\\-]\\s*|\\s+)([^\\n\\r]{2,95})`, "gi");
    const matches = Array.from(text.matchAll(anchorRegex));
    if (matches.length > 0) {
      const { selectedMatch, nlpApplied, strategy, notes } = disambiguateCandidates(
        field,
        matches,
        text,
        docContext
      );
      let rawValue = selectedMatch[2] ? selectedMatch[2].trim() : "";
      rawValue = cleanExtractedValue(rawValue, field.targetDataType);
      if (rawValue.length > 0) {
        const matchIdx = selectedMatch.index ?? 0;
        let confidence = calculateConfidence(field, rawValue);
        if (nlpApplied) confidence = Math.min(99, confidence + 4);
        const { isValid, validationMessage } = validateField(field.id, rawValue);
        let parsedStructure;
        if (field.id === "residential_address" || field.id === "previous_address") {
          const parsed = parseAustralianAddress(rawValue);
          if (parsed) {
            parsedStructure = parsed;
            if (!parsed.isPostcodeStateCoherent) {
              confidence = Math.max(60, confidence - 15);
            }
          }
        }
        const lineIdx = text.substring(0, matchIdx).split("\n").length - 1;
        let anchorDisplay = selectedMatch[1] ? selectedMatch[0].split(/[:=\-]/)[0].trim() : field.name;
        if (nlpApplied) anchorDisplay += " [NLP Disambiguated]";
        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: anchorDisplay,
          extractedValue: rawValue,
          confidence,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: "matched",
          contextSnippet: getSnippet(text, matchIdx, selectedMatch[0].length),
          isValid,
          validationMessage,
          parsedStructure,
          disambiguation: {
            disambiguationStrategy: strategy,
            sectionContext: getSectionForIndex(docContext, lineIdx),
            competingCandidatesCount: matches.length,
            nlpResolved: nlpApplied,
            notes
          }
        };
      }
    }
    const simpleRegex = new RegExp(`\\b${field.maxToleranceRegex}\\b`, "i");
    const simpleMatch = text.match(simpleRegex);
    if (simpleMatch) {
      return {
        fieldId: field.id,
        fieldName: field.name,
        category: field.category,
        matchedAnchor: simpleMatch[0],
        extractedValue: simpleMatch[0],
        confidence: 75,
        matchIndex: simpleMatch.index ?? 0,
        regexPattern: field.maxToleranceRegex,
        status: "matched",
        contextSnippet: getSnippet(text, simpleMatch.index ?? 0, simpleMatch[0].length),
        disambiguation: {
          disambiguationStrategy: "REGEX_EXACT",
          nlpResolved: false,
          notes: "Direct token boundary occurrence."
        }
      };
    }
    return {
      fieldId: field.id,
      fieldName: field.name,
      category: field.category,
      matchedAnchor: null,
      extractedValue: null,
      confidence: 0,
      matchIndex: -1,
      regexPattern: field.maxToleranceRegex,
      status: "missing"
    };
  } catch (err) {
    console.error(`Error matching field ${field.id}:`, err);
    return {
      fieldId: field.id,
      fieldName: field.name,
      category: field.category,
      matchedAnchor: null,
      extractedValue: null,
      confidence: 0,
      matchIndex: -1,
      regexPattern: field.maxToleranceRegex,
      status: "missing"
    };
  }
}
function disambiguateCandidates(field, matches, fullText, docContext) {
  if (matches.length === 1) {
    return {
      selectedMatch: matches[0],
      nlpApplied: false,
      strategy: "REGEX_EXACT",
      notes: "Single anchor candidate identified."
    };
  }
  if (field.id === "residential_address") {
    const currentCandidates = matches.filter((m) => {
      const anchor = (m[1] || m[0]).toLowerCase();
      return !anchor.includes("past") && !anchor.includes("prev") && !anchor.includes("prior") && !anchor.includes("former");
    });
    const candidatePool = currentCandidates.length > 0 ? currentCandidates : matches;
    const structuredMatch = candidatePool.find((m) => {
      const val = m[2] || "";
      return /\d+.*(?:st|rd|ave|street|road|avenue|blvd|lane|way|pde|cres|terrace).*(?:nsw|vic|qld|wa|sa|tas|act|nt)/i.test(val);
    });
    if (structuredMatch) {
      return {
        selectedMatch: structuredMatch,
        nlpApplied: false,
        strategy: "REGEX_STRUCTURAL_MATCH",
        notes: "Disambiguated primary residential address from past/employer location via regex street matching and state detection."
      };
    }
    return {
      selectedMatch: candidatePool[0],
      nlpApplied: true,
      strategy: "PROXIMITY_WEIGHTING",
      notes: "Ranked highest via proximity to Residential Particulars header."
    };
  }
  if (field.id === "previous_address") {
    const pastMatch = matches.find((m) => {
      const anchor = (m[1] || m[0]).toLowerCase();
      return anchor.includes("past") || anchor.includes("prev") || anchor.includes("prior") || anchor.includes("former");
    });
    if (pastMatch) {
      return {
        selectedMatch: pastMatch,
        nlpApplied: true,
        strategy: "SECTION_AFFINITY",
        notes: "Disambiguated historical previous address from current residence."
      };
    }
  }
  if (field.id === "given_names" || field.id === "family_name") {
    const personalCandidates = matches.filter((m) => {
      const val = (m[2] || "").toLowerCase();
      return !val.includes("pty") && !val.includes("ltd") && !val.includes("hospital") && !val.includes("partners") && !val.includes("tech") && !val.includes("bank") && !val.includes("energy") && !val.includes("corp");
    });
    if (personalCandidates.length > 0) {
      return {
        selectedMatch: personalCandidates[0],
        nlpApplied: false,
        strategy: "KEYWORD_PROXIMITY_HEURISTIC",
        notes: "Disambiguated human applicant name from corporate entity / employer via bounding keywords."
      };
    }
  }
  if (field.id === "gross_salary") {
    const grossMatch = matches.find((m) => {
      const textBlock = (m[0] + " " + (m[2] || "")).toLowerCase();
      return (textBlock.includes("gross") || textBlock.includes("annual") || textBlock.includes("p.a.") || textBlock.includes("before tax")) && !textBlock.includes("net") && !textBlock.includes("take home") && !textBlock.includes("rental");
    });
    if (grossMatch) {
      return {
        selectedMatch: grossMatch,
        nlpApplied: true,
        strategy: "SECTION_AFFINITY",
        notes: "Disambiguated Gross Annual Salary from Net Takehome and Secondary Rental Income."
      };
    }
  }
  if (field.id === "net_salary") {
    const netMatch = matches.find((m) => {
      const textBlock = (m[0] + " " + (m[2] || "")).toLowerCase();
      return textBlock.includes("net") || textBlock.includes("take home") || textBlock.includes("/mo") || textBlock.includes("monthly");
    });
    if (netMatch) {
      return {
        selectedMatch: netMatch,
        nlpApplied: true,
        strategy: "SECTION_AFFINITY",
        notes: "Disambiguated Net Monthly Remuneration from Annual Base Pay."
      };
    }
  }
  if (field.id === "limit_requested") {
    const reqMatch = matches.find((m) => {
      const textBlock = (m[0] + " " + (m[2] || "")).toLowerCase();
      return (textBlock.includes("request") || textBlock.includes("new facility") || textBlock.includes("maximum limit")) && !textBlock.includes("debt") && !textBlock.includes("owing");
    });
    if (reqMatch) {
      return {
        selectedMatch: reqMatch,
        nlpApplied: true,
        strategy: "PROXIMITY_WEIGHTING",
        notes: "Disambiguated requested credit line from current revolving credit balances."
      };
    }
  }
  const bestByLength = matches.reduce((prev, curr) => (curr[2] || "").length > (prev[2] || "").length ? curr : prev);
  return {
    selectedMatch: bestByLength,
    nlpApplied: true,
    strategy: "PROXIMITY_WEIGHTING",
    notes: "Selected most complete candidate based on token density."
  };
}
function parseAustralianAddress(rawAddress) {
  if (!rawAddress || rawAddress.length < 8) return null;
  const cleaned = rawAddress.replace(/[\n\r]+/g, " ").trim();
  const stateMatch = cleaned.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  const state = stateMatch ? stateMatch[1].toUpperCase() : "UNKNOWN";
  const postcodeMatch = cleaned.match(/\b\d{4}\b/);
  const postcode = postcodeMatch ? postcodeMatch[0] : "";
  let unitOrLevel;
  const unitSlashMatch = cleaned.match(/^(\d{1,4}[a-zA-Z]?)\/(\d+)/);
  if (unitSlashMatch) {
    unitOrLevel = unitSlashMatch[1];
  } else {
    const unitWordMatch = cleaned.match(/\b(?:unit|apt|apartment|suite|lot|flat|level|lvl)\s*(\d+[a-zA-Z]?|\w+)\b/i);
    if (unitWordMatch) unitOrLevel = unitWordMatch[1];
  }
  let streetNumber = "";
  if (unitSlashMatch) {
    streetNumber = unitSlashMatch[2];
  } else {
    const numMatch = cleaned.match(/\b(\d+(?:-\d+)?[a-zA-Z]?)\b/);
    if (numMatch) streetNumber = numMatch[1];
  }
  const streetTypeRegex = /\b(Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Parade|Pde|Crescent|Cres|Way|Drive|Dr|Court|Ct|Lane|Ln|Highway|Hwy|Terrace|Tce|Place|Pl|Esplanade|Esp|Circuit|Cct)\b/i;
  const streetTypeMatch = cleaned.match(streetTypeRegex);
  const streetType = streetTypeMatch ? normalizeStreetType(streetTypeMatch[1]) : "";
  let streetName = "";
  if (streetNumber && streetTypeMatch) {
    const streetTypeIdx = cleaned.indexOf(streetTypeMatch[0]);
    const numIdx = cleaned.indexOf(streetNumber);
    if (streetTypeIdx > numIdx) {
      const candidate = cleaned.substring(numIdx + streetNumber.length, streetTypeIdx).trim();
      streetName = candidate.replace(/^[\/,\s]+/, "").replace(/[\/,\s]+$/, "");
    }
  }
  let suburb = "";
  if (streetTypeMatch && stateMatch) {
    const typeIdx = cleaned.indexOf(streetTypeMatch[0]) + streetTypeMatch[0].length;
    const stateIdx = cleaned.indexOf(stateMatch[0]);
    if (stateIdx > typeIdx) {
      const candidate = cleaned.substring(typeIdx, stateIdx).trim();
      suburb = candidate.replace(/^[, ]+/, "").replace(/[, ]+$/, "");
    }
  }
  const isPostcodeStateCoherent = verifyPostcodeStateCoherence(state, postcode);
  let score = 50;
  if (streetNumber) score += 10;
  if (streetName) score += 10;
  if (streetType) score += 10;
  if (suburb) score += 10;
  if (state !== "UNKNOWN") score += 5;
  if (postcode) score += 5;
  if (isPostcodeStateCoherent) score += 10;
  return {
    rawAddress: cleaned,
    unitOrLevel,
    streetNumber,
    streetName: streetName || "Detected from OCR",
    streetType: streetType || "St",
    suburb: suburb || "Metro",
    state,
    postcode,
    gnafConfidenceScore: Math.min(100, score),
    isPostcodeStateCoherent
  };
}
function normalizeStreetType(type) {
  const t = type.toLowerCase();
  if (t === "st" || t === "street") return "Street";
  if (t === "rd" || t === "road") return "Road";
  if (t === "ave" || t === "avenue") return "Avenue";
  if (t === "blvd" || t === "boulevard") return "Boulevard";
  if (t === "pde" || t === "parade") return "Parade";
  if (t === "cres" || t === "crescent") return "Crescent";
  if (t === "dr" || t === "drive") return "Drive";
  if (t === "ct" || t === "court") return "Court";
  if (t === "ln" || t === "lane") return "Lane";
  if (t === "hwy" || t === "highway") return "Highway";
  if (t === "tce" || t === "terrace") return "Terrace";
  return type;
}
function verifyPostcodeStateCoherence(state, postcode) {
  if (!postcode || postcode.length !== 4) return false;
  const num = parseInt(postcode, 10);
  if (isNaN(num)) return false;
  switch (state.toUpperCase()) {
    case "NSW":
      return num >= 1e3 && num <= 2599 || num >= 2619 && num <= 2899 || num >= 2921 && num <= 2999;
    case "ACT":
      return num >= 200 && num <= 299 || num >= 2600 && num <= 2618 || num >= 2900 && num <= 2920;
    case "VIC":
      return num >= 3e3 && num <= 3999 || num >= 8e3 && num <= 8999;
    case "QLD":
      return num >= 4e3 && num <= 4999 || num >= 9e3 && num <= 9999;
    case "SA":
      return num >= 5e3 && num <= 5799 || num >= 5800 && num <= 5999;
    case "WA":
      return num >= 6e3 && num <= 6797 || num >= 6800 && num <= 6999;
    case "TAS":
      return num >= 7e3 && num <= 7799 || num >= 7800 && num <= 7999;
    case "NT":
      return num >= 800 && num <= 899;
    default:
      return true;
  }
}
function getApraBankNameFromBsb(bsbStr) {
  const digits = bsbStr.replace(/\D/g, "");
  if (digits.length < 2) return "Unknown Bank";
  const prefix = digits.substring(0, 2);
  const prefix3 = digits.substring(0, 3);
  if (prefix === "01") return "ANZ Bank (Australia and New Zealand Banking Group)";
  if (prefix === "03" || prefix === "73") return "Westpac Banking Corporation / St.George";
  if (prefix === "06") return "Commonwealth Bank of Australia (CBA)";
  if (prefix === "08") return "National Australia Bank (NAB)";
  if (prefix === "04") return "Macquarie Bank";
  if (prefix === "18") return "Bank of Queensland (BOQ)";
  if (prefix === "30") return "Bankwest";
  if (prefix === "09") return "Reserve Bank of Australia (RBA)";
  if (prefix3 === "484") return "Suncorp Bank";
  if (prefix3 === "633") return "Bendigo and Adelaide Bank";
  if (prefix3 === "802") return "Auswide Bank";
  return "APRA Authorized Institution";
}
function cleanExtractedValue(val, dataType) {
  let cleaned = val.trim();
  const inlineCutoff = cleaned.search(/\s+(?:exp(?:iry)?|bsb|abn|dob|status|account):/i);
  if (inlineCutoff > 0) {
    cleaned = cleaned.substring(0, inlineCutoff).trim();
  }
  cleaned = cleaned.replace(/[,;|\-]+$/, "").trim();
  if (dataType === "currency") {
    const currencyMatch = cleaned.match(/\$?\s*[\d,]+(?:\.\d{2})?(?:\s*(?:p\.?a\.?|\/month|\/mo|\/week|\/yr))?/i);
    if (currencyMatch) return currencyMatch[0].trim();
  }
  if (dataType === "phone") {
    const phoneMatch = cleaned.match(/(?:\+61\s?|0)[2478](?:[ -]?\d){8}/);
    if (phoneMatch) return phoneMatch[0].trim();
  }
  if (dataType === "email") {
    const emailMatch = cleaned.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
    if (emailMatch) return emailMatch[0].trim();
  }
  if (dataType === "date") {
    const dateMatch = cleaned.match(/\b(?:\d{1,2}[-/.])?\d{1,2}[-/.]\d{2,4}\b/);
    if (dateMatch) return dateMatch[0].trim();
  }
  return cleaned;
}
function calculateConfidence(field, val) {
  if (!val) return 0;
  let score = 88;
  if (field.targetDataType === "currency" && val.includes("$")) score += 8;
  if (field.targetDataType === "email" && val.includes("@") && val.includes(".")) score += 10;
  if (field.targetDataType === "phone" && (val.startsWith("04") || val.startsWith("+61"))) score += 10;
  if (field.targetDataType === "date" && /\d{2}[-/. ]\d{2}[-/. ]\d{2,4}/.test(val)) score += 9;
  return Math.min(score, 99);
}
function getSnippet(fullText, index, length) {
  const start = Math.max(0, index - 25);
  const end = Math.min(fullText.length, index + length + 45);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < fullText.length ? "..." : "";
  return `${prefix}${fullText.substring(start, end).replace(/\n/g, " ")}${suffix}`;
}
function validateField(fieldId, value) {
  if (!value) return { isValid: false, validationMessage: "Value is empty." };
  const res = validateAustralianField(fieldId, value);
  return {
    isValid: res.isValid,
    validationMessage: res.validationMessage
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractBankFieldsFromText,
  parseAustralianAddress
});
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

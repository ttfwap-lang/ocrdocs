/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BankFieldDefinition } from '../../types';
import { IDENTITY_EXTENDED_FIELDS } from './identityExtendedFields';
import { RESIDENTIAL_EXTENDED_FIELDS } from './residentialExtendedFields';
import { CONTACT_EXTENDED_FIELDS } from './contactExtendedFields';
import { EMPLOYMENT_EXTENDED_FIELDS } from './employmentExtendedFields';
import { INCOME_EXTENDED_FIELDS } from './incomeExtendedFields';
import { EXPENSE_EXTENDED_FIELDS } from './expenseExtendedFields';
import { ASSET_LIABILITY_EXTENDED_FIELDS } from './assetLiabilityExtendedFields';
import { FACILITY_EXTENDED_FIELDS } from './facilityExtendedFields';
import { STRUCTURAL_IDENTIFIER_FIELDS } from './structuralIdentifierFields';

export const EXTENDED_BANK_FIELD_DEFINITIONS: BankFieldDefinition[] = [
  ...IDENTITY_EXTENDED_FIELDS,
  ...RESIDENTIAL_EXTENDED_FIELDS,
  ...CONTACT_EXTENDED_FIELDS,
  ...EMPLOYMENT_EXTENDED_FIELDS,
  ...INCOME_EXTENDED_FIELDS,
  ...EXPENSE_EXTENDED_FIELDS,
  ...ASSET_LIABILITY_EXTENDED_FIELDS,
  ...FACILITY_EXTENDED_FIELDS,
];

export const EXTENDED_CORE_IDENTIFIER_DEFINITIONS: BankFieldDefinition[] = [
  ...STRUCTURAL_IDENTIFIER_FIELDS,
];

export {
  IDENTITY_EXTENDED_FIELDS,
  RESIDENTIAL_EXTENDED_FIELDS,
  CONTACT_EXTENDED_FIELDS,
  EMPLOYMENT_EXTENDED_FIELDS,
  INCOME_EXTENDED_FIELDS,
  EXPENSE_EXTENDED_FIELDS,
  ASSET_LIABILITY_EXTENDED_FIELDS,
  FACILITY_EXTENDED_FIELDS,
  STRUCTURAL_IDENTIFIER_FIELDS,
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BankFieldDefinition } from '../../types';

export const FACILITY_EXTENDED_FIELDS: BankFieldDefinition[] = [
  {
    id: 'product_type_requested',
    number: 86,
    name: 'Credit Facility / Product Type Requested',
    label: 'product_type_requested',
    category: 'facility',
    maxToleranceRegex: '(pr[o0]duct[_-]?type|faci[l1]ity[_-]?type|[l1][o0]an[_-]?pr[o0]duct|h[o0]me[_-]?[l1][o0]an[_-]?type|credit[_-]?card[_-]?type|[l1]ine[_-]?of[_-]?credit|faci[l1]ity[_-]?req[uv]e[s5]ted|target[_-]?pr[o0]duct)',
    description: 'Matches requested financial product: variable home loan, fixed loan, credit card, or line of credit.',
    targetDataType: 'text',
    exampleLabels: ['Product Type', 'Facility Type', 'Loan Product', 'Product Requested'],
    sampleExtractedValue: 'Principal and Interest Variable Home Loan',
  },
  {
    id: 'loan_amount_requested',
    number: 87,
    name: 'Loan Amount Requested',
    label: 'loan_amount_requested',
    category: 'facility',
    maxToleranceRegex: '([l1][o0]an[_-]?am[o0]unt|b[o0]rr[o0]wing[_-]?am[o0]unt|finance[_-]?am[o0]unt|req[uv]e[s5]ted[_-]?b[o0]rr[o0]wing|principa[l1][_-]?am[o0]unt|[l1][o0]an[_-]?[s5]um|am[o0]unt[_-]?t[o0][_-]?b[o0]rr[o0]w|faci[l1]ity[_-]?am[o0]unt)',
    description: 'Captures total principal loan or finance amount requested by applicant.',
    targetDataType: 'currency',
    exampleLabels: ['Loan Amount Requested', 'Borrowing Amount', 'Finance Amount', 'Principal Amount'],
    sampleExtractedValue: '$520,000.00',
  },
  {
    id: 'loan_purpose',
    number: 88,
    name: 'Loan / Credit Purpose',
    label: 'loan_purpose',
    category: 'facility',
    maxToleranceRegex: '([l1][o0]an[_-]?purp[o0][s5]e|purp[o0][s5]e[_-]?of[_-]?[l1][o0]an|b[o0]rr[o0]wing[_-]?purp[o0][s5]e|credit[_-]?purp[o0][s5]e|refinance|[o0]wner[_-]?[o0]ccupied|inve[s5]tment[_-]?purcha[s5]e|debt[_-]?c[o0]n[s5][o0][l1]idati[o0]n)',
    description: 'Extracts credit purpose: purchase primary residence, investment, refinance, or debt consolidation.',
    targetDataType: 'text',
    exampleLabels: ['Loan Purpose', 'Purpose of Loan', 'Borrowing Purpose', 'Credit Purpose'],
    sampleExtractedValue: 'Refinance of Existing Home Loan',
  },
  {
    id: 'repayment_frequency',
    number: 89,
    name: 'Requested Repayment Frequency',
    label: 'repayment_frequency',
    category: 'facility',
    maxToleranceRegex: '(repayment[_-]?freq[uv]ency|payment[_-]?freq[uv]ency|repayment[_-]?cyc[l1]e|m[o0]nth[l1]y[_-]?repayment[s5]?|f[o0]rtnight[l1]y[_-]?repayment[s5]?|week[l1]y[_-]?repayment[s5]?|repayment[_-]?interva[l1]|in[s5]ta[l1][l1]ment[_-]?freq[uv]ency)',
    description: 'Captures preferred loan repayment schedule: weekly, fortnightly, or monthly installments.',
    targetDataType: 'text',
    exampleLabels: ['Repayment Frequency', 'Payment Frequency', 'Repayment Cycle', 'Payment Interval'],
    sampleExtractedValue: 'Monthly',
  },
  {
    id: 'direct_debit_account',
    number: 90,
    name: 'Direct Debit / Settlement Account',
    label: 'direct_debit_account',
    category: 'facility',
    maxToleranceRegex: '(direct[_-]?debit|[s5]ett[l1]ement[_-]?acc[o0]unt|n[o0]minated[_-]?acc[o0]unt|repayment[_-]?acc[o0]unt|drawd[o0]wn[_-]?acc[o0]unt|aut[o0][_-]?debit|direct[_-]?debit[_-]?bank|bi[l1][l1]er[_-]?acc[o0]unt)',
    description: 'Matches nominated bank account designated for automatic direct debit repayment.',
    targetDataType: 'text',
    exampleLabels: ['Direct Debit Account', 'Settlement Account', 'Nominated Account', 'Repayment Account'],
    sampleExtractedValue: 'Commonwealth Bank of Australia (BSB 063-001 Acc 10293847)',
  },
];

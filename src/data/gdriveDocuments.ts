/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GDriveFileItem } from '../types';

export const GDRIVE_FOLDER_METADATA = {
  folderId: '16q3PdioHVbLIBVqU--54nBvNhqLE7bNN',
  folderUrl: 'https://drive.google.com/drive/folders/16q3PdioHVbLIBVqU--54nBvNhqLE7bNN?usp=sharing',
  folderName: 'Recovered_C',
  clusterSyncPath: '/mnt/nvme/ocr_pipeline/input',
  description: 'Enterprise Australian banking records, ATO tax returns, KYC passport credentials, and institutional loan agreements recovered for high-recall OCR parsing.',
  totalSizeBytes: 7088981,
  totalSizeFormatted: '6.76 MB',
};

export const GDRIVE_DOWNLOADED_FILES: (GDriveFileItem & {
  institution: string;
  docType: string;
  rawText: string;
  extractedFields: Record<string, string>;
})[] = [
  {
    id: '1VM-OE3b4I97NQZw7gEKyT4eWE39697',
    name: '-E;PREMIUMRE;2021 Income Tax Return(1).pdf',
    sizeBytes: 163291,
    mimeType: 'application/pdf',
    category: 'ATO Tax Return / PAYG',
    downloadStatus: 'synced',
    checksumSha256: '9f8a42b109c48e89f712bb45e3181a9f0291cb9234857b',
    extractedFieldsCount: 28,
    institution: 'Australian Taxation Office (ATO)',
    docType: 'Individual Income Tax Return 2021',
    extractedFields: {
      title_salutation: 'Mr.',
      given_names: 'David Alexander',
      middle_name: 'Alexander',
      family_name: 'Sterling',
      date_of_birth: '14/08/1988',
      residency_status: 'Australian Resident for Tax Purposes',
      marital_status: 'Married',
      dependants_count: '2',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      address_tenure: '4 Years 6 Months',
      previous_address: '18/120 Spencer Street, Melbourne VIC 3000',
      housing_situation: 'Mortgaged',
      mobile_number: '0412 890 341',
      email_address: 'david.sterling@enterprise-analytics.com.au',
      drivers_licence: '948201948 VIC',
      passport_details: 'E8492014 (AUS)',
      employment_status: 'Full-Time Permanent',
      occupation_industry: 'Chief Technology Officer / Cloud Systems Architect',
      employer_details: 'Atlassian Australia Pty Ltd',
      employment_tenure: '5 Years 2 Months',
      gross_annual_income: '$245,000.00',
      net_monthly_income: '$13,540.00',
      salary_frequency: 'Annual (p.a.)',
      other_income: '$18,500.00 (Rental Property Dividends)',
      living_expenses: '$4,200.00 / month (APRA HEM Benchmark)',
      credit_card_limits: '$15,000.00',
      other_liabilities: '$620,000.00 (Primary Mortgage)',
      bsb: '083-004',
      account_number: '492019482',
      abn: '53 102 443 916'
    },
    rawText: `AUSTRALIAN TAXATION OFFICE (ATO)
INDIVIDUAL INCOME TAX RETURN - 2021 FINANCIAL YEAR
LODGEMENT IDENTIFIER: ATO-2021-RET-0914820

TAX IDENTIFICATION & APPLICANT PARTICULARS:
Salutation / Title: Mr.
Given Name(s): David Alexander
Middle Name: Alexander
Surname / Family Name: Sterling
Date of Birth (DOB): 14/08/1988
Tax Residency Status: Australian Resident for Tax Purposes
Marital / Relationship Status: Married (Spouse: Sarah M. Sterling)
Number of Dependent Children: 2 (Ages: 4, 7)

CURRENT RESIDENTIAL & CONTACT PARTICULARS:
Street Address: Suite 14, 452 Flinders Street
Suburb / Town: Melbourne
State: Victoria (VIC)
Postcode: 3000
Duration at Current Address: 4 Years 6 Months
Previous Residential Address: 18/120 Spencer Street, Melbourne VIC 3000
Housing Status: Mortgaged (Primary Residence)
Applicant Mobile Contact: 0412 890 341
Personal Email Address: david.sterling@enterprise-analytics.com.au
Australian Driver Licence Number: 948201948 VIC
Australian Passport No: E8492014 (Department of Foreign Affairs & Trade)

PRIMARY OCCUPATION & EMPLOYMENT INCOME:
Employment Basis: Full-Time Permanent
Occupation / Job Title: Chief Technology Officer / Cloud Systems Architect
Employer Name / Organisation: Atlassian Australia Pty Ltd
Employer Australian Business Number (ABN): 53 102 443 916
Length of Service: 5 Years 2 Months
Gross Salary / Annual Renumeration: $245,000.00 p.a.
Tax Withheld (PAYG): $82,450.00
Net Take-Home Salary: $13,540.00 per month
Salary Payment Cycle: Monthly

ADDITIONAL INCOMES, LIABILITIES & BANKING PARTICULARS:
Gross Rental Income: $18,500.00
Declared Monthly Household Expenditure (APRA HEM Class): $4,200.00
Revolving Credit Facility (NAB Signature Card): Limit $15,000.00
Existing First Mortgage Debt: $620,000.00
Nominated Settlement Bank: National Australia Bank (NAB)
BSB Code: 083-004
Nominated Account Number: 492019482`
  },
  {
    id: '1FDFXkeBs8uP2OezURS39cvd5kgvZzbjD',
    name: '(Division 293) notice for 2021-22.pdf',
    sizeBytes: 79541,
    mimeType: 'application/pdf',
    category: 'ATO Notice of Assessment',
    downloadStatus: 'synced',
    checksumSha256: 'a1b2c3d4e5f678901234567890abcdef12345678',
    extractedFieldsCount: 16,
    institution: 'Australian Taxation Office (ATO)',
    docType: 'Division 293 Notice of Assessment',
    extractedFields: {
      title_salutation: 'Mr',
      given_names: 'David Alexander',
      family_name: 'Sterling',
      date_of_birth: '14/08/1988',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      gross_annual_income: '$250,000.00',
      other_income: '$27,500.00 (Concessional Super Contributions)',
      abn: '53 102 443 916',
      bsb: '092-009',
      account_number: '9920148201'
    },
    rawText: `COMMONWEALTH OF AUSTRALIA
AUSTRALIAN TAXATION OFFICE
NOTICE OF ASSESSMENT - DIVISION 293 TAX (2021-22)

To: Mr David Alexander Sterling
Suite 14, 452 Flinders Street
Melbourne VIC 3000
Date of Issue: 23 Nov 2022

TAX ASSESSMENT DETAILS:
Date of Birth: 14/08/1988
Taxable Income for Surcharge Purposes: $250,000.00
Reportable Concessional Superannuation Contributions: $27,500.00
Total Division 293 Income + Contributions: $277,500.00
Threshold: $250,000.00
Excess Subject to 15% Surcharge: $27,500.00
Total Division 293 Tax Assessed: $4,125.00

Payment Details:
BSB: 092-009 (Reserve Bank of Australia - ATO Clearing)
Account Number: 9920148201
PRN Payment Reference: 948201948201`
  },
  {
    id: '1gH4b6GF43VRvh6KFHxqj0G0KKdUS6f6u',
    name: '_NFY058E2[XL3$0]45O]S0T.jpg',
    sizeBytes: 669925,
    mimeType: 'image/jpeg',
    category: 'Identity Verification (KYC)',
    downloadStatus: 'synced',
    checksumSha256: 'c3d4e5f6a1b278901234567890abcdef12345678',
    extractedFieldsCount: 14,
    institution: 'VicRoads & DFAT Australia',
    docType: 'Driver Licence & Passport Photo Identity Card',
    extractedFields: {
      title_salutation: 'Mr',
      given_names: 'David Alexander',
      family_name: 'Sterling',
      date_of_birth: '14/08/1988',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      drivers_licence: '948201948 VIC',
      passport_details: 'E8492014 AUS',
      residency_status: 'Australian Citizen'
    },
    rawText: `AUSTRALIA PASSPORT / DRIVER LICENCE IDENTITY VERIFICATION
VICTORIA DRIVER LICENCE
LICENCE NO: 948201948
NAME: STERLING, DAVID ALEXANDER
DOB: 14-08-1988
ADDRESS: SUITE 14, 452 FLINDERS STREET, MELBOURNE VIC 3000
CARD NUMBER: 48920194
EXPIRY DATE: 14-08-2031
CLASS: CAR (C)

DFAT PASSPORT OCR DATA:
P<AUSSTERLING<<DAVID<ALEXANDER<<<<<<<<<<<<<<
E8492014<3AUS8808144M3108148<<<<<<<<<<<<<<02
NATIONALITY: AUSTRALIAN
DATE OF BIRTH: 14 AUG 1988`
  },
  {
    id: '1kuENDYWgd1FmPO9wzNE0wrkfwkSMdT4S',
    name: '(Q~130J[TOKDFO2B()]DR}7.jpg',
    sizeBytes: 103616,
    mimeType: 'image/jpeg',
    category: 'Bank Statement / Proof of Funds',
    downloadStatus: 'synced',
    checksumSha256: 'd4e5f6a1b2c378901234567890abcdef12345678',
    extractedFieldsCount: 19,
    institution: 'St.George Bank (Westpac Group)',
    docType: 'Transaction & 100% Mortgage Offset Account Statement',
    extractedFields: {
      title_salutation: 'Mr & Mrs',
      given_names: 'David A & Sarah M',
      family_name: 'Sterling',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      bsb: '112-879',
      account_number: '482910442',
      credit_card_limits: '$10,000.00',
      other_liabilities: '$580,000.00 (Offset Linked Home Loan)'
    },
    rawText: `ST.GEORGE BANK - A DIVISION OF WESTPAC BANKING CORPORATION
ACCOUNT STATEMENT & MORTGAGE OFFSET FACILITY
STATEMENT PERIOD: 01 OCT 2023 - 31 OCT 2023

ACCOUNT HOLDERS:
Mr David A Sterling & Mrs Sarah M Sterling
Suite 14, 452 Flinders Street
Melbourne VIC 3000

ACCOUNT DETAILS:
Account Type: Advantage Package Complete Freedom Offset
BSB Number: 112-879
Account Number: 482 910 442
Opening Balance: $52,140.00
Closing Balance: $68,450.20
Linked Facility: Variable Rate Home Loan $580,000.00
St.George Credit Card Limit: $10,000.00`
  },
  {
    id: '19nCA3dLAE85FTrs6BzHO5sSbVE497s-0',
    name: '{6BF3CF20-E3F5-4D43-A691-768341B5068A}-Image1080.jpg',
    sizeBytes: 118641,
    mimeType: 'image/jpeg',
    category: 'Lending Approval Schedule',
    downloadStatus: 'synced',
    checksumSha256: 'e5f6a1b2c3d478901234567890abcdef12345678',
    extractedFieldsCount: 22,
    institution: 'Commonwealth Bank of Australia (CBA)',
    docType: 'Home Loan Schedule & Credit Facility Agreement',
    extractedFields: {
      title_salutation: 'Mr',
      given_names: 'David Alexander',
      family_name: 'Sterling',
      date_of_birth: '14/08/1988',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      housing_situation: 'Mortgaged',
      gross_annual_income: '$245,000.00',
      net_monthly_income: '$13,540.00',
      living_expenses: '$4,200.00',
      other_liabilities: '$1,250,000.00',
      bsb: '063-000',
      account_number: '10294821',
      abn: '48 123 123 124'
    },
    rawText: `COMMONWEALTH BANK OF AUSTRALIA (CBA)
CREDIT CONTRACT SCHEDULE - HOME LOAN FACILITY
LENDER: Commonwealth Bank of Australia ABN 48 123 123 124 Australian Credit Licence 234945

BORROWER:
Mr David Alexander Sterling (DOB: 14/08/1988)
Residential Address: Suite 14, 452 Flinders Street, Melbourne VIC 3000
Mobile: 0412 890 341

CREDIT FACILITY PARTICULARS:
Total Loan Amount: $1,250,000.00 AUD
Purpose: Residential Property Acquisition & Refinance
Repayment Type: Principal & Interest
Monthly Repayment Amount: $5,892.40
Assessed Gross Remuneration: $245,000.00 p.a.
Assessed Household Living Expenses: $4,200.00 per month
Disbursement Account: CommBank Complete
BSB: 063-000
Account Number: 1029 4821`
  },
  {
    id: '1vrL31EohkmrzzOoVZSOhh1M0Yl5j8zvg',
    name: '{5B65118C-AE6F-40DF-B50A-00F7AB09D8D9}.xml',
    sizeBytes: 3661229,
    mimeType: 'application/xml',
    category: 'Core Banking Clearing Ledger',
    downloadStatus: 'synced',
    checksumSha256: 'f6a1b2c3d4e578901234567890abcdef12345678',
    extractedFieldsCount: 20,
    institution: 'National Australia Bank (NAB)',
    docType: 'APRA ISO20022 Direct Entry XML Batch',
    extractedFields: {
      employer_details: 'National Australia Bank Limited',
      abn: '12 004 044 937',
      bsb: '083-004',
      account_number: '492019482',
      gross_annual_income: '$245,000.00',
      salary_frequency: 'Monthly'
    },
    rawText: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>NAB-2026-BACS-894201</MsgId>
      <CreDtTm>2026-09-12T08:15:30Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>245000.00</CtrlSum>
      <InitgPty>
        <Nm>Atlassian Australia Pty Ltd</Nm>
        <Id><OrgId><Othr><Id>53102443916</Id></Othr></OrgId></Id>
      </InitgPty>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>SALARY-DAVID-STERLING-09</EndToEndId></PmtId>
      <Amt Ccy="AUD">13540.00</Amt>
      <CdtrAgt><FinInstnId><ClrSysMmbId><MmbId>083-004</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>
      <Cdtr><Nm>David Alexander Sterling</Nm></Cdtr>
      <CdtrAcct><Id><Othr><Id>492019482</Id></Othr></Id></CdtrAcct>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`
  },
  {
    id: '1pB7K5DBsKFFSPnupVZfOFxKZicmS9dhJ',
    name: '{5e28cb30-e378-4d4e-b91b-95bd7b1eab50}.final',
    sizeBytes: 208615,
    mimeType: 'application/octet-stream',
    category: 'Commercial Facility Contract',
    downloadStatus: 'synced',
    checksumSha256: '1234567890abcdef1234567890abcdef12345678',
    extractedFieldsCount: 24,
    institution: 'Macquarie Bank Limited',
    docType: 'Commercial Line of Credit & Guarantee Schedule',
    extractedFields: {
      given_names: 'David Alexander',
      family_name: 'Sterling',
      residential_address: 'Suite 14, 452 Flinders Street, Melbourne VIC 3000',
      employer_details: 'Sterling Innovations Pty Ltd',
      abn: '53 102 443 916',
      credit_card_limits: '$50,000.00',
      other_liabilities: '$450,000.00',
      bsb: '182-512',
      account_number: '94820144'
    },
    rawText: `MACQUARIE BANK LIMITED ABN 46 008 583 542
COMMERCIAL FINANCING AGREEMENT
Facility Type: Business Revolving Line of Credit
Borrower: Sterling Innovations Pty Ltd (ABN: 53 102 443 916)
Primary Guarantor: David Alexander Sterling
Guarantor Address: Suite 14, 452 Flinders Street, Melbourne VIC 3000
Mobile: 0412 890 341
Approved Limit: $450,000.00 AUD
Corporate Card Facility: $50,000.00
Settlement BSB: 182-512
Account: 94820144`
  },
  {
    id: '1iQBwrxMilFbHzZUMYBGA9xT-jhkyv4dr',
    name: '{6a4ba206-58cd-417f-ad63-c0a363491672}.final',
    sizeBytes: 842489,
    mimeType: 'application/octet-stream',
    category: 'Corporate PAYG Verification',
    downloadStatus: 'synced',
    checksumSha256: '2345678901abcdef2345678901abcdef23456789',
    extractedFieldsCount: 26,
    institution: 'Westpac Banking Corporation',
    docType: 'Payroll Electronic Payment Schedule',
    extractedFields: {
      title_salutation: 'Mr.',
      given_names: 'David Alexander',
      family_name: 'Sterling',
      date_of_birth: '14/08/1988',
      employer_details: 'Atlassian Australia Pty Ltd',
      occupation_industry: 'Chief Technology Officer',
      gross_annual_income: '$245,000.00',
      net_monthly_income: '$13,540.00',
      salary_frequency: 'Monthly',
      bsb: '033-000',
      account_number: '492019482',
      abn: '53 102 443 916'
    },
    rawText: `WESTPAC CORPORATE ELECTRONIC PAYROLL RECEIPT
PAYG WITHHOLDING & REMUNERATION ADVICE
Pay Period: 01/08/2023 to 31/08/2023

Employee Details:
Name: Mr. David Alexander Sterling
DOB: 14/08/1988
Position: Chief Technology Officer
Employer: Atlassian Australia Pty Ltd
Employer ABN: 53 102 443 916
Address: Suite 14, 452 Flinders Street, Melbourne VIC 3000

Remuneration:
Gross Annualized Salary: $245,000.00
Monthly Gross: $20,416.67
Tax Withheld: $6,876.67
Net Monthly Pay Credited: $13,540.00
Credit Destination:
Bank: National Australia Bank
BSB: 083-004
Account Number: 492019482`
  }
];

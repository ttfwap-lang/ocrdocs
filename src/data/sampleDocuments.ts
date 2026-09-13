/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SampleDocument } from '../types';

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    id: 'nab-credit-card-app',
    title: 'NAB Signature Card & BT Application (OCR Noise: l/1, o/0)',
    institution: 'National Australia Bank (NAB)',
    docType: 'Credit Card & Facility Onboarding',
    description: 'Scanned customer application form exhibiting extreme OCR character noise (1/l, 0/o, missing underscores/hyphens).',
    rawText: `NATIONAL AUSTRALIA BANK - RETAIL LENDING APPLICATION FORM
REF_NO: NAB-2025-8849201  PORTAL_STAGE: OCR_INGEST_STAGE_2

1. PERSONAL IDENTIFIER DETAILS
tit1e: Mr.
g1ven_name: Lachlan Oliver
mid_name: Edward
fam1ly_nm: MacIntyre-Smyth
d0b: 19/04/1986
citizen_status: Australian Citizen
maritalstatus: de-facto
dependants: 2
drv_lic: 94827104 VIC Expiry: 11/2028
passportno: N8492019A Exp: 15/09/2032

2. RESIDENTIAL & CONTACT PARTICULARS
residentialadd: 14/88 St Kilda Road, Southbank VIC 3006
timeathome: 3 yrs 8 months
past_address: 4/12 Darling St, South Yarra VIC 3141
housingtype: mortgaged
m0bi1e: 0423 881 902
emailaddress: lachlan.macintyre@meridian-tech.com.au

3. EMPLOYMENT & REMUNERATION (PAYE)
emp_status: full-time
jobtitle: Lead Data Architect
employername: Meridian Technologies Australia Pty Ltd
abn: 81 004 228 911
worktenure: 4 years 2 months
gross_salary: $185,000.00 p.a.
netmonthly: $11,240.00
variable_income: $22,500.00 Annual Performance Incentive

4. FINANCIAL POSITION & APRA EXPENSES
monthly_spend: $3,850.00 (HEM Groceries, Utilities, Private Health)
assetvalue: $920,000.00 (Investment Property, Superannuation, High-Interest Saver)
homeloan: $520,000.00 NAB Tailored Home Loan ($3,150/mo)
creditcarddebt: $8,000.00 ANZ Platinum (Limit: $15,000.00)
personalloan: $12,500.00 Macquarie Auto Finance ($420/mo)

5. FACILITY REQUEST
limitrequested: $20,000.00 NAB Qantas Signature Visa
balancetransfer: $6,500.00 from ANZ Platinum (Biller Code: 84920, Acct: 4509 8812 3901 2291)
bsb: 083-004
ACCOUNT_STATUS: PENDING_VERIFICATION`,
  },
  {
    id: 'cba-home-loan-inquiry',
    title: 'CBA Mortgage & Wealth Assessment Pack',
    institution: 'Commonwealth Bank of Australia (CBA)',
    docType: 'Mortgage / Home Loan Schedule',
    description: 'Mortgage assessment schedule featuring complex salary packages, multi-tier liabilities, and property declarations.',
    rawText: `COMMONWEALTH BANK OF AUSTRALIA (CBA)
HOME BUYER SERVICE - FULL ASSET & LIABILITY SCHEDULE (MORTGAGE E-FILE)
APPLICATION ID: CBA-HL-993021-NSW

APPLICANT 1:
Salutation: Dr
First Name: Sophia
Middle Name: Alexandra
Last Name: Sterling
Date of Birth: 02/11/1990
Residency Status: Permanent Resident
Relationship: Married
Dependant Count: 1
Driver Licence Number: 29482019 NSW
Passport Number: E4820194

ADDRESS & ACCOMMODATION:
Residential Address: 22 Ocean Avenue, Double Bay NSW 2028
Address Duration: 5 Years 1 Month
Former Residence: 105 Victoria St, Potts Point NSW 2011
Housing Status: Owned Outright
Contact Number: 0418 552 901
Contact Email: sophia.sterling@sydneyhealth.nsw.gov.au

PROFESSIONAL BACKGROUND:
Employment Status: Permanent Full-Time
Occupation: Specialist Medical Practitioner / Anaesthetist
Employer: St Vincent's Hospital Sydney
ABN: 77 052 334 190
Employment Duration: 6 Years
Gross Income: $265,000.00
Net Takehome: $14,800.00
Rental Income: $38,400.00 (Apartment in Surry Hills)

HEM LIVING COSTS & LIABILITIES:
Living Expenses: $4,500.00 / month
Asset Holdings: $1,650,000.00 (Principal Residence, Equities, Rest Super)
Mortgage Debt: $0.00 (Unencumbered)
Credit Limit: $25,000.00 CBA Diamond Card ($1,200 balance)
Car Loan Debt: $28,000.00 BMW Financial Services
Student Debt: $0.00 (HECS Cleared)

NEW FACILITY DETAILS:
Requested Limit: $850,000.00 Variable Rate Home Loan
BT Facility: $0.00 (Not requested)
BSB: 062-000  Account: 1092 8841`,
  },
  {
    id: 'westpac-stgeorge-payslip',
    title: 'Westpac / St.George Income & Identity Verification',
    institution: 'Westpac Banking Corporation',
    docType: 'PAYG Income Statement & Employment Record',
    description: 'Corporate payslip & identity verification pack with Australian tax, superannuation, and BSB details.',
    rawText: `WESTPAC INSTITUTIONAL BANKING & RETAIL VERIFICATION
DOCUMENT: PAYG REMUNERATION ADVICE & EMPLOYEE RECORD
PERIOD ENDING: 31/07/2025

EMPLOYEE PROFILE:
Honorific: Ms
Forename: Priya
Other Names: Deepa
Surname: Ramanathan
Birth Date: 28/05/1993
Citizenship: Citizen
Relationship Status: Single
Children: 0
DL Number: T9940129 SA
Travel Document Number: M39201948

LOCATION & CONTACT:
Street Address: 88 North Terrace, Adelaide SA 5000
Time at Address: 2 Years 4 Months
Prior Address: 15 King William Rd, Hyde Park SA 5061
Residential Status: Renting ($550/week)
Mobile: +61 405 918 273
E-mail Address: priya.ramanathan@adelaidecorp.com.au

EMPLOYMENT:
Work Role: Senior Financial Risk Analyst
Organisation: Santos Energy Australia
Workplace ABN: 80 007 550 923
Years Employed: 3 Years
Job Type: Full-Time
Annual Package: $142,000.00 Base Pay
Take Home Pay: $8,450.00 Monthly Net
Overtime / Bonus: $12,000.00 Cash Incentive

EXPENSES & LIABILITIES:
Living Cost: $2,700.00 Monthly Spend
Assets: $185,000.00 (Australian Super, Cash Deposit)
Home Loan: $0.00
Plastic Cards Limit: $6,000.00 Westpac Altitude Black
HECS HELP Debt: $18,400.00 Commonwealth HELP Scheme
Requested Limit: $10,000.00 Overdraft Facility
Transfer Amount: $3,200.00 Balance Transfer
BSB: 035-000`,
  },
  {
    id: 'anz-revolving-debt-bt',
    title: 'ANZ Balance Transfer & Debt Consolidation Request',
    institution: 'ANZ Banking Group',
    docType: 'Revolving Credit & Debt Consolidation',
    description: 'Application focused on balance transfers, multiple credit cards, store cards, BNPL, and requested credit limits.',
    rawText: `ANZ BANKING GROUP - BALANCE TRANSFER & DEBT FACILITY
FORM: BT-REFINANCE-2025-Q3

APPLICANT:
Prefix: Mrs
1st Name: Chloe
Middle Initials: M.
Second Surname: Bennett-Hall
Born On: 05/09/1982
Resident Status: PR Status
Marital Status: Married
Kids: 3
Card Number: DL-88392014-QLD

RESIDENTIAL:
Address Line: 55 Eagle Street, Brisbane QLD 4000
Tenure: 8 Years
Accommodation: Mortgaged
Cell: 0433 119 284
Mail: chloe.bennett@queenslandlegal.com.au

JOB & INCOME:
Employment Type: Permanent Part-Time
Profession: Senior Legal Counsel
Business Name: Queensland Legal Partners Pty Ltd
ABN: 12 884 920 119
Job Duration: 7 Yrs
Total Earnings: $135,000.00 Before Tax
Net Earnings: $7,900.00 / mo
Extra Income: $8,500.00 Rental Dividends

COMMITMENTS & APRA ASSESSMENTS:
Housing Cost: $3,900.00 / mo
Net Worth: $780,000.00
Mortgage Limit: $410,000.00 (Suncorp Home Loan)
Revolving Credit: $14,000.00 across 3 cards (Coles Mastercard, Latitude Gem Visa)
BNPL Debt: $1,400.00 Afterpay & Zip Pay
Installment Debt: $8,000.00
Maximum Limit: $15,000.00
BT Facility: $9,800.00 to consolidate 0% p.a. for 24 months
Biller Code: 34901
BSB: 014-002`,
  },
];

/**
 * The four CTA modules and the fallback section catalogue.
 *
 * MODULES drives the module cards, filter chips, tag colours and cart swatches.
 * SEED is the same 28 rows that supabase/schema.sql inserts into `products`.
 * It is used when .env has no Supabase credentials yet, so the shop still runs.
 * Once the database is connected, products come from there and SEED is unused.
 */

export const MODULES = [
  { slug:"financial-reporting", name:"Financial Reporting", short:"Financial Reporting", tag:"Financial Reporting",
    blurb:"Comprehensive notes for all FR sections.", tint:"var(--fr-tint)", ink:"var(--fr-ink)",
    icon:'<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9.5 17v-3M12.5 17v-5M15.5 17v-2"/>' },
  { slug:"management-accounting-finance", name:"Management Accounting & Finance", short:"MA & Finance", tag:"MA & Finance",
    blurb:"Detailed notes for all MA & F sections.", tint:"var(--ma-tint)", ink:"var(--ma-ink)",
    icon:'<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="3.5" rx="1"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>' },
  { slug:"taxation", name:"Taxation", short:"Taxation", tag:"Taxation",
    blurb:"In-depth notes for all Tax sections.", tint:"var(--tax-tint)", ink:"var(--tax-ink)",
    icon:'<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><path d="M8.5 15.5l4.5-4.5M9 11.2h.01M12.5 15.3h.01"/>' },
  { slug:"corporate-governance-auditing", name:"Corporate Governance & Auditing", short:"CG & Auditing", tag:"CG & Auditing",
    blurb:"Complete notes for all CG & A sections.", tint:"var(--cga-tint)", ink:"var(--cga-ink)",
    icon:'<path d="M12 2.8l7 2.9v5.6c0 4.3-2.9 8.1-7 9.9-4.1-1.8-7-5.6-7-9.9V5.7z"/><path d="M9 11.8l2.2 2.2 4.2-4.4"/>' }
];
export const MOD = Object.fromEntries(MODULES.map(m => [m.slug, m]));

export const PRICE = 2500; // cents → R25
export const SEED = [
  ["FR1","Conceptual Framework & Presentation","Conceptual framework, IAS 1 presentation, accounting policies, estimates and errors.","financial-reporting"],
  ["FR2","Assets — PPE, Intangibles & Impairment","Recognition, measurement, revaluation, depreciation and IAS 36 impairment testing.","financial-reporting"],
  ["FR3","Financial Instruments","Classification, measurement, expected credit losses and hedge accounting basics.","financial-reporting"],
  ["FR4","Revenue & Leases","The five-step revenue model and IFRS 16 lessee and lessor accounting.","financial-reporting"],
  ["FR5","Group Statements & Consolidations","Business combinations, goodwill, NCI, associates and joint arrangements.","financial-reporting"],
  ["FR6","Income Taxes & Deferred Tax","Current and deferred tax, temporary differences and the tax rate reconciliation.","financial-reporting"],
  ["FR7","Employee Benefits & Provisions","Defined benefit plans, share-based payments, provisions and contingencies.","financial-reporting"],
  ["FR8","Earnings per Share & Cash Flows","Basic and diluted EPS, headline earnings and statement of cash flows.","financial-reporting"],

  ["MA1","Cost & Management Accounting","Cost behaviour, absorption vs variable costing, allocation and activity-based costing.","management-accounting-finance"],
  ["MA2","Budgeting & Variance Analysis","Budget preparation, flexed budgets and full material, labour and overhead variances.","management-accounting-finance"],
  ["MA3","Performance Management","Divisional performance, ROI, residual income, transfer pricing and balanced scorecards.","management-accounting-finance"],
  ["MA4","Working Capital Management","Cash, debtors, creditors and inventory cycles, plus short-term funding decisions.","management-accounting-finance"],
  ["MA5","Cost of Capital & Capital Structure","WACC, CAPM, gearing, dividend policy and the theories behind them.","management-accounting-finance"],
  ["MA6","Capital Budgeting & Valuations","NPV, IRR, sensitivity analysis and DCF-based business valuations.","management-accounting-finance"],
  ["MA7","Risk Management & Derivatives","Financial risk, forwards, futures, options and hedging strategies.","management-accounting-finance"],

  ["TAX1","Gross Income & Special Inclusions","Gross income definition, residence, source and the special inclusions.","taxation"],
  ["TAX2","Deductions & Capital Allowances","General deduction formula, prohibited deductions and section 11 allowances.","taxation"],
  ["TAX3","Capital Gains Tax","Asset disposals, base cost, exclusions, rollovers and the eighth schedule.","taxation"],
  ["TAX4","Individuals & Employees' Tax","Fringe benefits, allowances, retirement funds, PAYE and provisional tax.","taxation"],
  ["TAX5","Companies & Dividends Tax","Company taxable income, dividends tax, distributions and group transactions.","taxation"],
  ["TAX6","Value-Added Tax","Supplies, input and output tax, adjustments, imports and VAT administration.","taxation"],
  ["TAX7","Trusts, Estate Duty & Donations Tax","Trust taxation, attribution rules, estate duty and donations tax computations.","taxation"],

  ["CGA1","Corporate Governance & King IV","King IV principles, board responsibilities, stakeholder inclusivity and ethics.","corporate-governance-auditing"],
  ["CGA2","Companies Act & Legal Framework","Directors' duties, solvency and liquidity, and the CA 2008 essentials for PGDA.","corporate-governance-auditing"],
  ["CGA3","Audit Planning & Risk Assessment","Engagement acceptance, materiality, risk of material misstatement and strategy.","corporate-governance-auditing"],
  ["CGA4","Audit Evidence & Procedures","Assertions, sampling, substantive procedures and tests of controls by cycle.","corporate-governance-auditing"],
  ["CGA5","Reporting & Audit Opinions","Forming an opinion, modifications, KAMs, going concern and other reports.","corporate-governance-auditing"],
  ["CGA6","Professional Ethics & Independence","The IRBA/SAICA codes, threats, safeguards and independence in practice.","corporate-governance-auditing"]
].map(([code,title,description,module_slug],i)=>({
  id:"seed-"+code, code, title, description, module_slug,
  price_cents:PRICE, sort_order:i, preview_pages:0
}));

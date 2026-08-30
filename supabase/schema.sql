-- ============================================================
-- CTA NOTES BY COURTS — Supabase schema
-- Run this whole file in Supabase → SQL Editor → New query → Run
-- ============================================================

-- ------------------------------------------------------------
-- 1. MODULES  (the 4 CTA modules)
-- ------------------------------------------------------------
create table if not exists public.modules (
  slug        text primary key,
  name        text not null,
  blurb       text,
  sort_order  int  not null default 0
);

insert into public.modules (slug, name, blurb, sort_order) values
  ('financial-reporting',            'Financial Reporting',              'Comprehensive notes for all FR sections.', 1),
  ('management-accounting-finance',  'Management Accounting & Finance',  'Detailed notes for all MA & F sections.',  2),
  ('taxation',                       'Taxation',                         'In-depth notes for all Tax sections.',     3),
  ('corporate-governance-auditing',  'Corporate Governance & Auditing',  'Complete notes for all CG & A sections.',  4)
on conflict (slug) do nothing;


-- ------------------------------------------------------------
-- 2. PRODUCTS  (one row = one section = one PDF)
--    file_path points at an object in the private `notes` bucket,
--    e.g. 'financial-reporting/FR1-conceptual-framework.pdf'
-- ------------------------------------------------------------
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,              -- FR1, TAX3, ...
  title        text not null,
  description  text,
  module_slug  text not null references public.modules(slug),
  price_cents  int  not null default 2500,        -- R25.00
  file_path    text,                              -- storage path to the PDF
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists products_module_idx on public.products (module_slug, sort_order);


-- ------------------------------------------------------------
-- 3. ORDERS  (customer email captured here)
--    items is a snapshot of the cart at purchase time, so the
--    order stays correct even if a product is later edited.
-- ------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,
  email          text not null,
  full_name      text,
  items          jsonb not null default '[]'::jsonb,
  total_cents    int not null,
  status         text not null default 'pending'  -- pending | paid | failed | refunded
                 check (status in ('pending','paid','failed','refunded')),
  payment_ref    text,                            -- PayFast pf_payment_id later
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists orders_email_idx  on public.orders (email);
create index if not exists orders_status_idx on public.orders (status, created_at desc);


-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--    Anyone may read active products.
--    Anyone may create an order (that's the checkout).
--    Nobody with the anon key may read, edit or delete orders —
--    you read them in the Supabase dashboard, and your PayFast
--    webhook will update them using the service_role key.
-- ------------------------------------------------------------
alter table public.modules  enable row level security;
alter table public.products enable row level security;
alter table public.orders   enable row level security;

drop policy if exists "modules are public"  on public.modules;
create policy "modules are public"
  on public.modules for select
  to anon, authenticated
  using (true);

drop policy if exists "active products are public" on public.products;
create policy "active products are public"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "anyone can create an order" on public.orders;
create policy "anyone can create an order"
  on public.orders for insert
  to anon, authenticated
  with check (
    total_cents >= 0
    and status = 'pending'
    and char_length(email) between 5 and 320
  );
-- deliberately no select/update/delete policy on orders


-- ------------------------------------------------------------
-- 5. PRIVATE STORAGE BUCKET FOR THE PDFS
--    Private = nobody can hotlink the files. After payment you
--    generate a short-lived signed URL and email it.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('notes', 'notes', false)
on conflict (id) do nothing;


-- ------------------------------------------------------------
-- 6. SEED — 28 sections at R25 each
-- ------------------------------------------------------------
insert into public.products (code, title, description, module_slug, price_cents, sort_order) values
-- Financial Reporting
('FR1','Conceptual Framework & Presentation','Conceptual framework, IAS 1 presentation, accounting policies, estimates and errors.','financial-reporting',2500,1),
('FR2','Assets — PPE, Intangibles & Impairment','Recognition, measurement, revaluation, depreciation and IAS 36 impairment testing.','financial-reporting',2500,2),
('FR3','Financial Instruments','Classification, measurement, expected credit losses and hedge accounting basics.','financial-reporting',2500,3),
('FR4','Revenue & Leases','The five-step revenue model and IFRS 16 lessee and lessor accounting.','financial-reporting',2500,4),
('FR5','Group Statements & Consolidations','Business combinations, goodwill, NCI, associates and joint arrangements.','financial-reporting',2500,5),
('FR6','Income Taxes & Deferred Tax','Current and deferred tax, temporary differences and the tax rate reconciliation.','financial-reporting',2500,6),
('FR7','Employee Benefits & Provisions','Defined benefit plans, share-based payments, provisions and contingencies.','financial-reporting',2500,7),
('FR8','Earnings per Share & Cash Flows','Basic and diluted EPS, headline earnings and statement of cash flows.','financial-reporting',2500,8),

-- Management Accounting & Finance
('MA1','Cost & Management Accounting','Cost behaviour, absorption vs variable costing, allocation and activity-based costing.','management-accounting-finance',2500,9),
('MA2','Budgeting & Variance Analysis','Budget preparation, flexed budgets and full material, labour and overhead variances.','management-accounting-finance',2500,10),
('MA3','Performance Management','Divisional performance, ROI, residual income, transfer pricing and balanced scorecards.','management-accounting-finance',2500,11),
('MA4','Working Capital Management','Cash, debtors, creditors and inventory cycles, plus short-term funding decisions.','management-accounting-finance',2500,12),
('MA5','Cost of Capital & Capital Structure','WACC, CAPM, gearing, dividend policy and the theories behind them.','management-accounting-finance',2500,13),
('MA6','Capital Budgeting & Valuations','NPV, IRR, sensitivity analysis and DCF-based business valuations.','management-accounting-finance',2500,14),
('MA7','Risk Management & Derivatives','Financial risk, forwards, futures, options and hedging strategies.','management-accounting-finance',2500,15),

-- Taxation
('TAX1','Gross Income & Special Inclusions','Gross income definition, residence, source and the special inclusions.','taxation',2500,16),
('TAX2','Deductions & Capital Allowances','General deduction formula, prohibited deductions and section 11 allowances.','taxation',2500,17),
('TAX3','Capital Gains Tax','Asset disposals, base cost, exclusions, rollovers and the eighth schedule.','taxation',2500,18),
('TAX4','Individuals & Employees'' Tax','Fringe benefits, allowances, retirement funds, PAYE and provisional tax.','taxation',2500,19),
('TAX5','Companies & Dividends Tax','Company taxable income, dividends tax, distributions and group transactions.','taxation',2500,20),
('TAX6','Value-Added Tax','Supplies, input and output tax, adjustments, imports and VAT administration.','taxation',2500,21),
('TAX7','Trusts, Estate Duty & Donations Tax','Trust taxation, attribution rules, estate duty and donations tax computations.','taxation',2500,22),

-- Corporate Governance & Auditing
('CGA1','Corporate Governance & King IV','King IV principles, board responsibilities, stakeholder inclusivity and ethics.','corporate-governance-auditing',2500,23),
('CGA2','Companies Act & Legal Framework','Directors'' duties, solvency and liquidity, and the CA 2008 essentials for CTA.','corporate-governance-auditing',2500,24),
('CGA3','Audit Planning & Risk Assessment','Engagement acceptance, materiality, risk of material misstatement and strategy.','corporate-governance-auditing',2500,25),
('CGA4','Audit Evidence & Procedures','Assertions, sampling, substantive procedures and tests of controls by cycle.','corporate-governance-auditing',2500,26),
('CGA5','Reporting & Audit Opinions','Forming an opinion, modifications, KAMs, going concern and other reports.','corporate-governance-auditing',2500,27),
('CGA6','Professional Ethics & Independence','The IRBA/SAICA codes, threats, safeguards and independence in practice.','corporate-governance-auditing',2500,28)
on conflict (code) do nothing;

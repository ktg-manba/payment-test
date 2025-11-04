-- zpay 交易记录表，用于存储交易与订阅信息
create table if not exists public.zpay_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 业务关联
  user_id uuid not null,
  product_id text not null,

  -- 金额与币种
  amount numeric(12,2) not null,
  currency text not null default 'CNY',

  -- 支付与订单信息
  out_trade_no text not null,
  zpay_trade_no text,
  type text, -- alipay / wxpay
  name text, -- 商品名称
  pid text,  -- 商户ID

  -- 状态 pending/success/failed/cancelled
  status text not null default 'pending',

  -- 附加参数与原始回调
  param text,
  raw_notify jsonb,

  -- 订阅相关
  is_subscription boolean not null default false,
  subscription_period text, -- monthly/yearly
  start_at timestamptz,
  end_at timestamptz,

  constraint uq_out_trade_no unique (out_trade_no)
);

-- 触发器：自动更新时间戳
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_on_zpay_transactions on public.zpay_transactions;
create trigger set_timestamp_on_zpay_transactions
before update on public.zpay_transactions
for each row execute function public.set_updated_at();

-- 索引
create index if not exists idx_zpay_transactions_user on public.zpay_transactions(user_id);
create index if not exists idx_zpay_transactions_out_trade_no on public.zpay_transactions(out_trade_no);
create index if not exists idx_zpay_transactions_status on public.zpay_transactions(status);
create index if not exists idx_zpay_transactions_product on public.zpay_transactions(product_id);


-- CrawlHive: целевая схема Postgres. В MVP данные живут в памяти (src/lib/server/store.ts),
-- эта схема повторяет те же сущности и нужна для перехода на настоящую базу.

create table wallets (
  address      text primary key,               -- base58 Solana-адрес
  balance      numeric(20, 2) not null default 0, -- внутренние credits
  burned       numeric(20, 2) not null default 0,
  created_at   timestamptz not null default now()
);

create type crawl_source as enum ('x', 'telegram', 'onchain', 'docs');
create type crawl_chain  as enum ('solana', 'base', 'ethereum');
create type crawl_tier   as enum ('larva', 'worker', 'soldier', 'queen');
create type crawl_status as enum ('active', 'paused', 'rented');

create table crawlers (
  id             text primary key,             -- CRWL-XXXX
  name           text not null check (char_length(name) between 2 and 24),
  owner          text not null references wallets(address),
  renter         text references wallets(address),
  rented_until   timestamptz,
  source         crawl_source not null,
  chain          crawl_chain not null,
  narratives     text[] not null,
  targets        text[] not null,
  frequency_min  int not null check (frequency_min between 1 and 1440),
  tier           crawl_tier not null,
  burned         numeric(20, 2) not null,
  payment_unit   text,                          -- SOL или тикер токена проекта, null для симулированного спавна
  payment_amount numeric(20, 9),
  payment_tx     text unique,                   -- подпись транзакции оплаты
  status         crawl_status not null default 'active',
  created_at     timestamptz not null default now(),
  -- счётчики, которые обновляют воркеры
  items          bigint not null default 0,
  signals        int not null default 0,
  hits           int not null default 0,
  uptime_sec     double precision not null default 0,
  rewards        numeric(20, 2) not null default 0,
  reputation     int not null default 0
);
create index crawlers_owner_idx on crawlers(owner);
create index crawlers_reputation_idx on crawlers(reputation desc);

create table signals (
  id           bigserial primary key,
  crawler_id   text not null references crawlers(id) on delete cascade,
  kind         text not null,
  ticker       text not null,
  body         text not null,
  confidence   real not null,
  outcome      boolean,                         -- null пока не проверен, затем hit/miss
  created_at   timestamptz not null default now()
);
create index signals_recent_idx on signals(created_at desc);
create index signals_crawler_idx on signals(crawler_id, created_at desc);

create table listings (
  id          text primary key,
  crawler_id  text not null unique references crawlers(id) on delete cascade,
  seller      text not null references wallets(address),
  type        text not null check (type in ('sale', 'rent')),
  price       numeric(20, 2) not null check (price > 0),
  rent_days   int check (rent_days between 1 and 30),
  created_at  timestamptz not null default now()
);

create table trades (
  id          bigserial primary key,
  listing_id  text not null,
  crawler_id  text not null references crawlers(id),
  seller      text not null,
  buyer       text not null,
  type        text not null,
  paid        numeric(20, 2) not null,
  fee_burned  numeric(20, 2) not null,
  created_at  timestamptz not null default now()
);

create table proposals (
  id          text primary key,                 -- HIP-N
  title       text not null,
  description text not null default '',
  kind        text not null check (kind in ('priority', 'rewards', 'params')),
  author      text not null references wallets(address),
  created_at  timestamptz not null default now(),
  ends_at     timestamptz not null
);

create table proposal_options (
  proposal_id text not null references proposals(id) on delete cascade,
  id          text not null,
  label       text not null,
  primary key (proposal_id, id)
);

create table votes (
  proposal_id text not null references proposals(id) on delete cascade,
  wallet      text not null references wallets(address),
  option_id   text not null,
  weight      numeric(20, 2) not null,          -- баланс на момент голоса (позже — снапшот на блок)
  created_at  timestamptz not null default now(),
  primary key (proposal_id, wallet)
);

create table public.runs (
    id bigint generated always as identity primary key,
    location text not null check (location in ('cogon', 'carmen', 'highway')),
    time_of_day time not null,
    mode text not null check (mode in ('fixed', 'smart')),
    weather text not null check (weather in ('clear', 'rainy')),
    duration_sec int not null check (duration_sec >= 0),
    avg_wait numeric(7,2) not null check (avg_wait >= 0),
    vehicles_passed int not null check (vehicles_passed >= 0),
    passengers int not null check (passengers >= 0),
    longest_queue int not null check (longest_queue >= 0),
    created_at timestamptz not null default now()
);

alter table public.runs enable row level security;

grant select, insert on public.runs to anon;

create policy "Anyone can read runs"
on public.runs for select
to anon
using (true);

create policy "Anyone can add runs"
on public.runs for insert
to anon
with check (true);

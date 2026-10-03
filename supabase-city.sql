create table public.city_runs (
    id bigint generated always as identity primary key,
    mode text not null check (mode in ('fixed', 'smart')),
    weather text not null check (weather in ('clear', 'rainy')),
    sim_date date not null,
    day_type text not null check (char_length(day_type) <= 120),
    start_time time not null,
    duration_sec int not null check (duration_sec >= 0),
    avg_wait numeric(8,2) not null check (avg_wait >= 0),
    vehicles_passed int not null check (vehicles_passed >= 0),
    worst_intersection text check (char_length(worst_intersection) <= 120),
    worst_queue int not null default 0 check (worst_queue >= 0),
    green_wave boolean not null default false,
    ped_phase boolean not null default false,
    hourly_wait jsonb,
    created_at timestamptz not null default now()
);

create table public.custom_lights (
    id bigint generated always as identity primary key,
    name text not null check (char_length(name) between 1 and 80),
    main_road text check (char_length(main_road) <= 80),
    cross_road text check (char_length(cross_road) <= 80),
    lat double precision not null check (lat between 8.3 and 8.6),
    lon double precision not null check (lon between 124.5 and 124.85),
    rank int not null default 4 check (rank between 1 and 5),
    created_at timestamptz not null default now()
);

create table public.flood_zones (
    id bigint generated always as identity primary key,
    name text not null check (char_length(name) between 1 and 80),
    lat double precision not null check (lat between 8.3 and 8.6),
    lon double precision not null check (lon between 124.5 and 124.85),
    radius_m int not null check (radius_m between 50 and 2000),
    created_at timestamptz not null default now()
);

create table public.calibrations (
    id bigint generated always as identity primary key,
    intersection_name text not null check (char_length(intersection_name) <= 120),
    main_factor numeric(5,2) not null check (main_factor between 0.1 and 10),
    cross_factor numeric(5,2) not null check (cross_factor between 0.1 and 10),
    minutes int not null check (minutes between 1 and 60),
    main_count int not null check (main_count >= 0),
    cross_count int not null check (cross_count >= 0),
    counted_at time not null,
    created_at timestamptz not null default now()
);

alter table public.city_runs enable row level security;
alter table public.custom_lights enable row level security;
alter table public.flood_zones enable row level security;
alter table public.calibrations enable row level security;

grant select, insert on public.city_runs to anon;
grant select, insert, delete on public.custom_lights to anon;
grant select, insert, delete on public.flood_zones to anon;
grant select, insert on public.calibrations to anon;

create policy "Anyone can read city runs" on public.city_runs for select to anon using (true);
create policy "Anyone can add city runs" on public.city_runs for insert to anon with check (true);

create policy "Anyone can read lights" on public.custom_lights for select to anon using (true);
create policy "Anyone can add lights" on public.custom_lights for insert to anon with check (true);
create policy "Anyone can remove lights" on public.custom_lights for delete to anon using (true);

create policy "Anyone can read flood zones" on public.flood_zones for select to anon using (true);
create policy "Anyone can add flood zones" on public.flood_zones for insert to anon with check (true);
create policy "Anyone can remove flood zones" on public.flood_zones for delete to anon using (true);

create policy "Anyone can read calibrations" on public.calibrations for select to anon using (true);
create policy "Anyone can add calibrations" on public.calibrations for insert to anon with check (true);

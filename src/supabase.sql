-- 在 Supabase 控制台 SQL Editor 中执行以下语句
-- 创建起名历史表
create table if not exists name_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  surname text not null,          -- 姓氏
  gender text,                    -- 性别
  mode text not null default 'normal',  -- normal 经典起名 / bazi 生辰八字起名
  requirement text,               -- 用户起名需求
  birth_date text,                -- 出生日期（八字模式）
  birth_time text,                -- 出生时辰（八字模式）
  names jsonb not null,           -- 生成的 3 个名字方案 [{name, pinyin, meaning}]
  model text                      -- 使用的模型
);

-- 开启行级安全（服务端使用 service_role 密钥写入，不受 RLS 限制）
alter table name_history enable row level security;

-- 常用查询：
-- select * from name_history order by created_at desc limit 20;

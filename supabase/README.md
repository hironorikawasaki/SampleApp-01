# DB マイグレーション（Supabase / PostgreSQL）

新しい Supabase プロジェクトでは、**番号順に** SQL Editor へ貼り付けて実行します。

| 順 | ファイル | 内容 |
|----|----------|------|
| 1 | `0001_init_schema.sql` | 型・テーブル・ビュー・RLS・サインアップトリガー一式 |
| 2 | `0002_profiles_admin.sql` | プロフィール管理 RLS ＋ 特権カラム保護トリガー |
| 3 | `0003_multi_store.sql` | 店舗・所属・店舗別 RLS（既存データは「本店」へ移行） |
| 4 | `0004_push_subscriptions.sql` | Web Push 購読テーブル |
| 5 | `0005_promote_owner.sql` | 最初のオーナーを昇格する管理関数 |
| 6 | `0006_attendance.sql` | 実績勤怠（出退勤の打刻）＋RLS＋改ざん防止トリガー |

## 冪等（idempotent）

すべてのファイルは**何度実行しても安全**に作られています
（`create table if not exists` / `create or replace` / `drop policy if exists`
→ `create policy` / ENUM は存在チェック付き）。再実行・環境再構築でも壊れません。

## 適用状況の確認

各ファイルは末尾で `schema_migrations` に自分のバージョンを記録します。
適用済みを確認するには：

```sql
select version, applied_at from schema_migrations order by version;
```

## 新しいマイグレーションを足すとき

1. 次の番号で `00NN_説明.sql` を追加する。
2. 冪等に書く（既存テーブルの変更は `add column if not exists` 等）。
3. 末尾に記録を入れる：
   ```sql
   insert into schema_migrations (version) values ('00NN_説明')
     on conflict (version) do nothing;
   ```
4. この表に1行追記する。

> 順序の依存：`0002` は `0001` の後、`0003` は `0001・0002` の後、
> `0005` は `0002`（保護トリガー）の後に実行すること。

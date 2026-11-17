# Vifrost

Vifrost generates a REST API — routes, controllers, FormRequests — directly from
your Laravel Eloquent models, and ships a typed frontend ecosystem
(`@vifrost/client`, `@vifrost/codegen`, `@vifrost/vue`) to consume it without
hand-writing HTTP calls.

**This library is NOT stable yet. Use it at your own risk.**

This README is split in three parts:

1. [Backend (Laravel package)](#1-backend-laravel-package)
2. [Models in vanilla JS/TS (`@vifrost/client`)](#2-models-in-vanilla-jsts-vifrostclient), with and without the `Registry`
3. [Vue (`@vifrost/vue`)](#3-vue-vifrostvue)

---

## 1. Backend (Laravel package)

### Requirements

- PHP `^8.3`
- Laravel `^12.0` or `^13.0` (`illuminate/database`, `illuminate/support`, `illuminate/container`, `illuminate/console`)
- [`spatie/laravel-query-builder`](https://spatie.be/docs/laravel-query-builder) `^6.0`

### Installation

```bash
composer require vifrost/laravel
```

The service provider (`Vifrost\Laravel\Providers\VifrostServiceProvider`) is
auto-discovered. Optionally publish the config file to tweak it:

```bash
php artisan vendor:publish --tag=config
```

This publishes `config/vifrost.php`:

```php
return [
    // Columns never exposed in generated FormRequest validation rules. '*.column'
    // matches that column on every table; 'table.column' matches just one table.
    'ignored_columns' => ['*.created_at', '*.updated_at', '*.deleted_at'],

    // URL path segments ignored when resolving a request to a model (compared
    // case-insensitively), e.g. the "api" prefix in /api/product/1.
    'exclude' => ['api'],

    // Where Vifrost::models() looks for Eloquent models, relative to app_path().
    // Scanned live on every call unless `php artisan vifrost:cache` has written a
    // cache file — see "Caching discovered models" below.
    'models_path' => 'Models',

    // Models left out of the schema, codegen, `vifrost:api` (all) and request
    // routing, as FQCNs — e.g. internal models the API should not expose.
    'exclude_models' => [
        // \App\Models\User::class,
    ],

    // Leaves out models that extend Illuminate\Database\Eloquent\Relations\Pivot.
    'exclude_pivots' => true,

    // Joins the values of a composite primary key in URLs — see "Composite primary keys".
    'composite_key_separator' => ',',

    // Where `php artisan vifrost:schema` writes the models/attributes/relations JSON.
    'schema_path' => storage_path('app/vifrost-schema.json'),

    // Off by default: exposes the same JSON at schema_route_path over HTTP, for
    // adapter-generation tooling that needs to read it from a running server
    // instead of from the file the artisan command writes.
    'expose_schema_route' => false,
    'schema_route_path'   => 'api/_schema',
    // Middleware for the schema route, e.g. ['api', 'auth:sanctum'].
    'schema_route_middleware' => [],

    // Off by default: the endpoint @vifrost/client calls to refresh its lists in one
    // request when records change — see "Keeping lists in sync" below.
    'sync_route' => [
        'enabled'     => false,
        'path'        => 'api/_vifrost/sync',
        'middleware'  => ['api'],
        'max_queries' => 20,
    ],

    // Hard ceiling on rows a collection query (index, or a nested relation
    // collection) returns per request, applied even with no ?limit= at all.
    'max_limit' => 100,

    // Per-model overrides, keyed by model FQCN. Set a model's value to null to
    // exempt it from pagination entirely (e.g. a small, rarely-changing lookup table).
    'max_limit_per_model' => [
        // \App\Models\Category::class => null,
    ],

    // Datasets (see "Datasets" below): rows of selected columns, joins and aggregates
    // requested through a model's index route. Each part is enabled per controller;
    // these options only bound what an enabled one can do.
    'dataset' => [
        // Max rows per request. A dataset always requires ?limit=; exceeding it is a 422.
        'max_limit' => 1000,
        // Per-model overrides. Unlike max_limit_per_model, null does not exempt.
        'max_limit_per_model' => [
            // \App\Models\Order::class => 5000,
        ],
        // Milliseconds each query of a dataset may run before the database cancels it
        // (504). PostgreSQL, MySQL and MariaDB only; null disables it.
        'timeout_ms' => 5000,
        'timeout_ms_per_model' => [
            // \App\Models\Order::class => 15000,
        ],
        // Max nesting of whereHas/whereDoesntHave, counting the first level.
        'max_has_depth' => 3,
        // Time zone date periods are computed in, e.g. 'America/New_York'; ?tz= overrides it.
        // null groups values as the database returns them.
        'timezone' => null,
        // Time zone the app stores datetimes without a zone in; null means app.timezone.
        'storage_timezone' => null,
    ],

    // Eloquent relation methods Vifrost looks for via reflection when mapping
    // a model's relations (see Mapper.php).
    'relations' => [
        'hasMany', 'hasOne', 'belongsTo', 'belongsToMany',
        'hasOneThrough', 'hasManyThrough',
        'morphOne', 'morphMany', 'morphTo', 'morphToMany', 'morphedByMany',
    ],
];
```

### Usage

Generate a FormRequest, Controller, and routes for one model:

```bash
# Store/UpdateUserRequest + UserController + routes for \App\Models\User
php artisan vifrost:api User
```

Or for every model in `app/Models` (skipping `exclude_models` and, by default, pivots):

```bash
php artisan vifrost:api
```

This appends to `routes/api.php` a flat CRUD group for the model itself...

```php
Route::controller('\App\Http\Controllers\UserController')->group(function () {
    Route::get('user', 'index');
    Route::get('user/{id}', 'show');
    Route::post('user', 'store');
    Route::put('user/{id}', 'update');
    Route::delete('user/{id}', 'destroy');
});
```

...plus one-hop, read-only routes for each of its relations (see [`MakeAPICommand`](src/Commands/MakeAPICommand.php)):

```php
Route::get('user/{id}/posts', [\App\Http\Controllers\PostController::class, 'index']);
Route::get('user/{id}/posts/{childId}', [\App\Http\Controllers\PostController::class, 'show']);
```

Deeper relations (`posts.comments`) aren't routed as their own endpoint — they're
reachable in a single request via Spatie's `?include=posts.comments` on the flat
`index`/`show` route instead, since every generated controller wires
`Spatie\QueryBuilder\QueryBuilder` with `allowedIncludes` for the model's relations.

`vifrost:api` is a one-time kickoff, not something meant to keep `routes/api.php` in
sync forever — the expectation is that you'll hand-edit the generated routes
afterward (adding middleware, auth, dropping a verb, ...), the same way
`vifrost:controller`/`vifrost:request` already refuse to overwrite an existing
Controller/FormRequest unless you pass `--force`. If `routes/api.php` already
references a model's controller, `vifrost:api` asks before appending that model's
route block again, so a later re-run (e.g. generating "all" models after adding one
new one) can't silently reintroduce a route you'd since removed or duplicate ones
you'd since customized. Pass `--force` to skip the prompt (e.g. in CI, or when you
genuinely want a fresh block appended alongside the old one).

Filtering, sorting and includes are opt-in per model, and the generated controller
keeps the first two consolidated in one place — `allowedFilters()`/`allowedIncludes()`
private methods shared by both `index()` and `show()` — so extending them can't
accidentally leave the two endpoints out of sync with each other. `allowedFilters()`
starts empty and `->allowedSorts([...])` ships pre-filled with only
`['id', 'created_at', 'updated_at']`. Edit those methods in
`app/Http/Controllers/{Model}Controller.php` with whichever columns should be
filterable/sortable before relying on `.where()`/`.orderBy()` from the JS client
(part 2) — otherwise Spatie ignores the corresponding query param.

Collection endpoints (`index`, and any nested relation collection) accept
`?limit=` / `?offset=`, resolved in the generated controller's own `index()` method
against the `max_limit` / `max_limit_per_model` config (see
[`Pagination`](src/Pagination.php)) — deliberately not hidden inside `Vifrost::getQuery()`,
so pagination stays visible and editable in the file you actually own. `index()` also
reports how many rows matched (independent of the current page) via an `X-Total-Count`
response header, for building a pager on the client. A model configured as exempt from
pagination (`max_limit_per_model` set to `null`) has no default limit to offset within,
so `?offset=` with no `?limit=` given returns a `422` instead of being silently ignored
— pass an explicit `?limit=` alongside it and it works normally, even for an exempt
model. Single-record endpoints (`show`) never paginate.

You can also generate just one piece:

```bash
php artisan vifrost:request StoreUserRequest User   # FormRequest only
php artisan vifrost:controller User                # Controller only (hidden command, used internally)
```

### Composite primary keys

A model whose table has a composite primary key sets `$primaryKey = null` and
`$incrementing = false`. Vifrost reads the key columns from the table's primary
index and identifies a record by its key values joined with
`composite_key_separator` (`,` by default), in the order of the key columns:

```
GET    /api/staffmemberrole/5,3
PUT    /api/staffmemberrole/5,3
DELETE /api/staffmemberrole/5,3
GET    /api/staffmember/5/roles/5,3
```

`vifrost:api` generates a controller that updates and deletes through a query
scoped by the key, since Eloquent cannot save a model without a single primary
key. Key values must not contain the separator.

### Datasets

A dataset is a collection request that returns rows of chosen columns instead of
records: columns of the model and of the relations it joins, `whereHas` conditions,
aggregates, groups and date periods — for charts, reports or exports. It is a `GET`
to the model's index route with `?select=`, `?aggregate=` or `?group=`, so the route's
middleware runs as for any listing, and it is built in the same `query()`.

Generated controllers build `query()` with `Vifrost\Laravel\QueryBuilder`, Spatie's
query builder plus `allowedDataset()`, which takes what a dataset may use from a
private method of the controller. Every list starts empty, so there is no dataset until
the method allows columns or aggregates:

```php
private function allowedDataset(): array
{
    return [
        // Columns of the model, dotted for those of a joined or has relation.
        'columns' => ['status', 'amount', 'placed_at', 'customer.name', 'items.price', 'items.refunds.reason'],
        // BelongsTo, HasOne, HasMany and BelongsToMany relations of the model.
        'joins' => ['customer', 'items'],
        // Relations for whereHas/whereDoesntHave; each nested level needs its parent too.
        'has' => ['items', 'items.refunds'],
        'aggregates' => ['count', 'sum', 'avg', 'min', 'max'],
    ];
}

public function query(Request $request): QueryBuilder
{
    return QueryBuilder::for((new Vifrost)->getQuery($request), $request)
        ->allowedFilters($this->allowedFilters())
        ->allowedIncludes($this->allowedIncludes())
        ->allowedSorts(['id', 'created_at', 'updated_at'])
        ->allowedDataset($this->allowedDataset());
}
```

Controllers generated by 0.9.0 pass the same lists through `allowedColumns()`,
`allowedJoins()`, `allowedHas()` and `allowedAggregates()`. Those methods are deprecated
but keep working, and `vifrost:schema` still reads them; moving their lists into one
`allowedDataset()` is all it takes to update.

Columns and relations only ever come from these lists; the request supplies values,
which are bound. A request with dataset parameters for a model whose columns and
aggregates are both empty gets a `400` ("Datasets are not enabled for …"). A column
the model hides (`$hidden`, or missing from `$visible`) cannot be allowed at all.

```
GET /api/order
  ?join=customer:left                           # inner by default
  &select=customer.name
  &aggregate[total]=count
  &aggregate[revenue]=sum:amount
  &where[0][column]=status&where[0][op]==&where[0][value]=done
  &where[1][or][0][column]=amount&where[1][or][0][op]=>&where[1][or][0][value]=100
  &has[items][count]=>=2
  &has[items][where][0][column]=price&has[items][where][0][op]=>=&has[items][where][0][value]=50
  &has[items][has][refunds][where][0][column]=reason&has[items][has][refunds][where][0][op]=in&has[items][has][refunds][where][0][value][0]=damaged
  &group[]=customer.name                        # a column, also selected
  &group[month]=placed_at:month                 # a period, selected under its key: day, week (from Monday), month or year
  &tz=America/New_York                          # the time zone periods start and end in
  &sort=month,-total
  &limit=100&offset=0
```

```json
[{ "customer.name": "Alice", "month": "2026-01-01", "total": 4, "revenue": 350.0 }]
```

- Operators: `= != < <= > >= in notIn between null notNull`; `or`/`and` group conditions.
  Conditions of a has level name its columns without the relation (`price`, not
  `items.price`); `has[x][negate]=1` is a `whereDoesntHave`.
- `?group=` takes columns, which must also be selected (as a list: `group[]=…`, or
  `group=status,kind`), and date periods by key, each selected under that key as the
  first date of its period. Once a dataset groups or aggregates, every selected column
  must be grouped.
  Aggregates alone return one row. Aggregates come back as numbers; columns as the
  database returns them.
- A period starts and ends in the time zone of `?tz=`, or `dataset.timezone`, so an order
  placed late in the evening falls on its local day, not on the next one in UTC.
  `timestamptz` columns convert from the instant they hold; datetimes without a zone from
  `dataset.storage_timezone`; date columns have no time to convert. MySQL and MariaDB need
  their time zone tables loaded (`mysql_tzinfo_to_sql`), and SQLite cannot convert at all.
- **Every joined or has relation is read through its own model's controller `query()`**,
  so the tenant scope, global scopes and `viewAny` authorization of that model apply too
  (a `403` there is a `403` for the dataset), along with the conditions the relation
  method itself declares (`->where(...)`, `->wherePivot(...)`). When neither restricts it,
  the table is joined directly instead of a subquery. A relation's model needs a
  generated controller with `query()`.
- `?limit=` is always required and must not exceed `dataset.max_limit` (`422` otherwise,
  never clamped); `X-Total-Count` reports the rows of the whole dataset. Read a large one
  page by page with `?offset=`.
- On PostgreSQL, MySQL and MariaDB each query of a dataset runs under `dataset.timeout_ms`,
  set on the session and restored afterwards; a cancelled one answers `504`.
- `?filter=`, `?include=` and `?sort=` of Spatie do not apply to a dataset, and a single
  record route (`{model}/{id}`) ignores dataset parameters.

`vifrost:schema` exports what each model's rules allow, read from those private methods
without running `query()`, so `@vifrost/codegen` can type its datasets (rules written
inline in `query()` work the same, untyped).

### Exporting the schema for the JS/TS tooling

```bash
php artisan vifrost:schema [--path=storage/app/vifrost-schema.json]
```

Writes a JSON map of every model's table, resource name, `maxLimit`, columns
(type, nullability, defaults, foreign keys) and relations — this is what
`@vifrost/codegen` (part 2) reads to generate typed model classes. If
`expose_schema_route` is enabled, the same JSON is served live at
`schema_route_path` (`api/_schema` by default) instead of needing the file.

### Caching discovered models

`Vifrost::models()` (used by every generated controller to resolve `{model}` in a URL,
and by `vifrost:api`/`vifrost:schema` to find "all" models) scans `models_path` and
reflects on every file it finds there, on every call — fine for a handful of models
locally, wasteful on a production request. Nothing is cached by default; opt in with:

```bash
php artisan vifrost:cache   # write bootstrap/cache/vifrost-models.php
php artisan vifrost:clear   # remove it, restoring the live scan
```

This follows the same manually-invalidated convention as `config:cache`/`route:cache`:
once a cache file exists, `models()` reads it instead of scanning — so re-run
`vifrost:cache` after adding, removing, or moving a model, the same way you'd re-run
`config:cache` after editing `.env`. There's no automatic invalidation (a model added
by hand, or by any tool other than vifrost's own generators, wouldn't be visible to
trigger one anyway), so add `vifrost:cache` to your deploy step deliberately if you
use it, rather than relying on it locally.

---

## 2. Models in vanilla JS/TS (`@vifrost/client`)

Framework-agnostic runtime: a `Model` base class, a `QueryBuilder` compatible with
`spatie/laravel-query-builder`'s query params, and an opt-in `Registry` identity map.

### Requirements

- Node 18+ or any modern browser (only depends on native `fetch`)
- TypeScript 5+ recommended

### Installation

```bash
npm install @vifrost/client
npm install --save-dev @vifrost/codegen   # to generate Model classes from your schema
```

### Generating typed model classes

Export the schema from Laravel (part 1), then generate:

```bash
npx vifrost-codegen -i storage/app/vifrost-schema.json -o resources/js/models
```

```
Options:
  -i, --input <pathOrUrl>          schema JSON file path, or the exposed schema route URL
  -o, --output <dir>               directory to write the generated .ts files to
  -t, --type-map <path>            JSON file with { "dbTypeName": "tsType" } overrides
  -c, --client-import <specifier>  import specifier for the runtime client (default: "@vifrost/client")
```

This produces one file per model, plus an `index.ts`. Files an earlier run generated
for models no longer in the schema (excluded, deleted) are removed; files without the
generated header are never touched.

```typescript
// resources/js/models/Product.ts — generated, do not edit by hand
import { Model } from '@vifrost/client'
import { Category } from './Category.js'

export class Product extends Model {
  static resource = 'product'
  static primaryKey = 'id'
  static maxLimit = 100 // null if this model is exempt from pagination

  declare id: number
  declare name: string
  declare price: string
  declare category_id: number

  category(): Promise<Category | null> {
    return this.toOne('category', Category)
  }
}
```

### 2.1 Without a `Registry` (plain query API)

Call `configure()` once, then use each model's static/instance methods directly —
nothing is tracked or cached beyond the lifetime of each call.

```typescript
import { configure } from '@vifrost/client'
import { Category } from './models/Category.js'
import { Product } from './models/Product.js'

configure({ baseUrl: 'https://api.example.com/api' })

// find / all
const product = await Product.find(1)
const allActive = await Product.query().where('status', 'active').limit(10).get()

// Eloquent-like chaining: where / orderBy / with / limit / offset (take/skip aliases)
const products = await Product.query()
  .where('category_id', 3)
  .orderBy('created_at', 'desc')
  .with('category')
  .limit(20)
  .offset(40)
  .get()

// whereId(id).first() — hits the dedicated GET /product/{id} endpoint, not a filtered collection
const one = await Product.query().whereId(1).first()

// relations, from an already-loaded instance
const category = await product.category()          // BelongsTo/HasOne/MorphOne -> Model | null
const relatedProducts = await category.products()   // HasMany/BelongsToMany/etc -> Model[]

// eager-loaded relations are read under their relation names, even though Laravel
// serializes them in snake_case (`shipping_address` → `order.shippingAddress`)
const [order] = await Order.query().with('shippingAddress').limit(1).get()

// a query of a relation of one record, through its nested route — chainable and
// watchable like any query of the related model
const orders = await Customer.related(5, 'orders', Order).orderBy('id').limit(20).get()

// create / update / delete
const created = await new Product({ name: 'New', price: '9.99', category_id: 3 }).save()
created.price = '12.99'
await created.save()          // PUT, since the primary key is now set
await created.delete()
```

A model with a composite primary key (see "Composite primary keys" above) declares
its key columns as a list, and takes the key values in that order:

```typescript
class StaffMemberRole extends Model {
  static resource = 'staffmemberrole'
  static primaryKey = ['staff_member_id', 'role_id'] as const
  // static keySeparator = ','  — must match the backend's composite_key_separator
}

const role = await StaffMemberRole.find([5, 3])                // GET /staffmemberrole/5,3
await new StaffMemberRole({ staff_member_id: 5, role_id: 4, level: 1 }).save()  // POST
role.level = 2
await role.save()                                               // PUT /staffmemberrole/5,3
```

Since the key columns are set before a record is created, `save()` sends a PUT
only for records fetched from or already saved to the server.

If a model declares a non-null `static maxLimit` (i.e. the backend requires
pagination for it), `QueryBuilder` fails fast **client-side**, before any network
request:

```typescript
await Product.all()
// throws: "product requires a limit (max 100). Call .limit(n) (n <= 100) before .get()."

await Product.query().limit(1000).get()
// throws: ".limit(1000) exceeds the max allowed for product (100)."
```

This is stricter than the server, which would silently clamp an over-limit
request — the point is to catch it in development instead of silently returning
a truncated page.

### 2.2 With a `Registry` (identity map, kept in sync)

Pass a `Registry` to `configure()` to opt into an identity map: every `find`/`all`/
`query`/relation fetch registers its rows, `save()`/`delete()` publish into the same
map, and anything can `subscribe()` to a specific `resourceType:id` and get notified
in place — no polling, ready to be driven later by a WebSocket/SSE "record changed"
event via `registry.resync(resourceType, id)`.

```typescript
import { configure, Registry } from '@vifrost/client'
import { Product } from './models/Product.js'

const registry = new Registry()
configure({ baseUrl: 'https://api.example.com/api', registry })

const product = await Product.find(1) // now tracked under "product:1"

const unsubscribe = registry.subscribe('product', 1, (event) => {
  if (event.type === 'updated') {
    console.log('fresh value:', event.value)
  } else {
    console.log('record 1 was deleted')
  }
})

// Any later save() on a Product with id 1 — from anywhere in the app — notifies this listener:
product.name = 'Renamed'
await product.save() // -> listener fires with { type: 'updated', value: product }

await product.delete() // -> listener fires with { type: 'deleted' }, then the entry is untracked

unsubscribe()
```

Without a `Registry` configured, `save()`/`delete()` skip this entirely — the
modularity is deliberate: a consumer who only wants the plain query API never pays
for tracking it doesn't use.

The instance the Registry tracks is the one every list shows, so an edit form should
not type into it. `clone()` returns an untracked copy: changing it changes nothing
else, and its `save()` updates the record and publishes the saved values only once
the server accepts them:

```typescript
const draft = product.clone()
draft.name = form.name
await draft.save() // a rejection leaves every list showing the original values
```

Two queries of the same record with different `.with(...)` share its entry: a fetch
with fewer relations keeps the ones it lacks, and a resync requests every relation
any fetch of the record loaded.

### 2.3 Keeping lists in sync

Lists watched through `@vifrost/vue`'s `useQuery` (or `getQueryCache().watch()`)
always share one request per identical query. With a `Registry` configured they also
stay in sync: rows follow the Registry, and the lists of a resource refresh when the
Registry reports one of its records created, updated or deleted, so a new record
enters the lists it belongs to and a changed one moves or leaves. Without a `Registry`,
lists only change when refetched.

Local `save()`/`delete()` report to the Registry on their own. Changes made elsewhere
(another tab, another user) are reported with `events`, typically from a real-time
transport such as Laravel Echo with model broadcasting. Events carry only the record's
id, and `events` encodes it with the model's key the way the Registry tracks it
(`registry.created()`, `registry.updated()` and `registry.remove()` take the encoded id
directly). An update re-fetches the record once if it is tracked, which also refreshes
every list showing it:

```typescript
import { events } from '@vifrost/client'

echo.private(`clinic.${clinicId}.patients`)
  .listen('.PatientCreated', (event) => events.created(Patient, event.id))
  .listen('.PatientUpdated', (event) => events.updated(Patient, event.id))
  .listen('.PatientDeleted', (event) => events.deleted(Patient, event.id))
```

With Eloquent model broadcasting, the bridge is built in. On the model, the
`Vifrost\Laravel\Broadcasting\BroadcastsVifrostEvents` trait broadcasts created,
updated, deleted, trashed and restored events carrying only the record's key (every
column of a composite one), so clients reload the record through the API, which
applies authorization; the model still defines the channels:

```php
class Product extends Model
{
    use BroadcastsVifrostEvents;

    public function broadcastOn(string $event): array
    {
        return [new PrivateChannel("store.{$this->store_id}")];
    }
}
```

On the client, `listenToModelBroadcasts()` reports every model event of a channel to
the Registry, finding each model by its class name in the generated models module:

```typescript
import { listenToModelBroadcasts } from '@vifrost/client'
import * as models from './models/index.js'

listenToModelBroadcasts(echo.private(`store.${storeId}`), models)
```

Events that arrive close together (`debounceMs`, 50 by default) are handled at once.
By default each affected list is refetched. To refresh them all in a single request,
enable `sync_route` on the Laravel side and point the client at it:

```typescript
configure({
  baseUrl: 'https://api.example.com/api',
  registry,
  sync: { path: '_vifrost/sync', debounceMs: 50, maxQueries: 20 },
})
```

The endpoint runs each list through the `query()` method of its generated controller,
with filters, sorts, includes and pagination taken from the list's query string, and
returns the page's ids, the total and only the rows the client does not have yet.
Because it does not dispatch a request per list, **the route middleware of each list
does not run**: `sync_route.middleware` guards them all (add your auth middleware
there), and any customization of a list (e.g. scoping it to the current tenant) must
live in the controller's `query()`, which `index()` and `show()` also use, rather than
in `index()`. For the same reason the generated `query()` authorizes the model's
`viewAny` ability as soon as the model has a policy, so a list the user may not read
reports `403` in its own entry of the batch while the others still refresh. Controllers
generated before that only need the same check at the top of their `query()`:

```php
if (Gate::getPolicyFor(Product::class)) {
    Gate::authorize('viewAny', Product::class);
}
```

Controllers generated before `query()` existed, or an endpoint that is
disabled, make the client fall back to refetching. To register the endpoint inside a
route group of your own, leave `enabled` false and call `Vifrost::syncRoute()` there.

### 2.4 Datasets

`Dataset.for()` builds a dataset (see "Datasets" in part 1). Its rows are frozen plain
objects keyed by the requested columns and aggregates — not `Model` instances, and
never tracked by the Registry. For a generated model whose controller allows datasets,
the builder only accepts what the rules allow, and types each row by what it selects:

```typescript
import { Dataset } from '@vifrost/client'

const rows = await Dataset.for(Order)
  .leftJoin('customer')
  .select('customer.name')
  .groupByDate('placed_at', 'month', 'month')
  .timezone('America/New_York')
  .count('total')
  .sum('amount', 'revenue')
  .where('status', '=', 'done')
  .whereAny((any) => any.where('amount', '>', 100).whereNull('discount_code'))
  .whereHas('items', (item) => item.where('price', '>=', 50).whereHas('refunds', (refund) => refund.whereIn('reason', ['damaged'])), '>=', 2)
  .whereDoesntHave('returns')
  .groupBy('customer.name')
  .orderBy('month')
  .limit(100)
  .get()
// rows: readonly { 'customer.name': string | null; month: string; total: number; revenue: number | null }[]
// rows.total: the rows of the whole dataset, for paging through an export
```

`.limit()` is always required, up to the model's `datasetMaxLimit`, and checked before
any request. `Dataset.for(Customer.related(5, 'orders', Order))` or
`Dataset.for('customer/5/orders')` start an untyped dataset of a relation. A
controller without datasets rejects with `DatasetNotEnabledError`, and one the database
cancelled with `DatasetTimeoutError`.

`getDatasetCache().watch(builder)` (and `useDataset` in Vue) shares one request per
identical dataset and, with a Registry, requests it again whenever a record of its model,
or of a relation it joins or filters by, is reported created, updated or deleted. A
dataset never takes part in a sync request.

---

## 3. Vue (`@vifrost/vue`)

`useModel`/`useQuery`/`useDataset` composables wrapping `@vifrost/client`, reactive to both
their inputs (a ref/getter id or query) and — when a `Registry` is configured — to
`Registry` events for the rows they're currently holding.

### Requirements

- Vue `^3.3.0`
- `@vifrost/client` configured somewhere in your app bootstrap (as in part 2)

### Installation

```bash
npm install @vifrost/vue
```

### 3.1 Without a `Registry`

`useQuery`/`useModel` work the same whether or not a `Registry` is configured — the
difference is only whether results stay in sync after the initial fetch (3.2).

```vue
<script setup lang="ts">
import { useModel, useQuery } from '@vifrost/vue'
import { Category } from './models/Category.js'
import { Product } from './models/Product.js'
import { ref } from 'vue'

const productId = ref(1)

// useModel(ModelClass, id) — id can be a plain value, a ref, or a getter
const { data: product, error, isLoading, refetch } = useModel(Product, productId)

// useQuery(builder) — pass a GETTER (not a resolved builder) whenever the query
// depends on something reactive, so it re-runs when that dependency changes
const { data: activeInCategory } = useQuery(() =>
  Product.query().where('category_id', productId.value).where('status', 'active').orderBy('name')
)

// A plain builder is fine too when the query never changes
const { data: categories } = useQuery(Category.query().limit(50))
</script>

<template>
  <p v-if="isLoading">Loading…</p>
  <p v-else-if="error">{{ error }}</p>
  <p v-else>{{ product?.name }}</p>
</template>
```

Both composables return `{ data, error, isLoading, refetch }` — `data` is `null`
(for `useModel`) or `[]` (for `useQuery`) until the first response resolves, and
`refetch()` re-runs the same query on demand.

### 3.2 With a `Registry`

Configure a `Registry` once during app bootstrap (part 2.2) — from a component's
point of view nothing else changes. `useQuery`/`useModel` subscribe to every row
they're currently displaying and patch it in place on an `updated`/`deleted` event,
without an extra network round-trip:

```typescript
// main.ts
import { configure, Registry } from '@vifrost/client'

configure({ baseUrl: 'https://api.example.com/api', registry: new Registry() })
```

```vue
<script setup lang="ts">
import { useModel } from '@vifrost/vue'
import { Product } from './models/Product.js'

const { data: product } = useModel(Product, 1)

async function rename() {
  product.value!.name = 'Renamed'
  await product.value!.save() // any other component's useModel(Product, 1) updates too
}
</script>
```

`useDataset` works like `useQuery` for a dataset (part 2.4): a getter makes it request
the dataset again when a dependency changes, cancelling the request it replaces.

```vue
<script setup lang="ts">
import { Dataset } from '@vifrost/client'
import { useDataset } from '@vifrost/vue'
import { ref } from 'vue'
import { Order } from './models/Order.js'

const status = ref('done')

const { data: perMonth, total, isLoading, error } = useDataset(() =>
  Dataset.for(Order)
    .groupByDate('placed_at', 'month', 'month')
    .count('total')
    .where('status', '=', status.value)
    .orderBy('month')
    .limit(24)
)
</script>
```

Because `useModel(Product, 1)` is built on `useQuery` (it resolves through
`Product.query().whereId(1)`, the same endpoint `find()` uses), any two components
that fetched product `1` independently share the same `Registry` entry — a `save()`
in one updates the other's `data` reactively, with no manual event wiring.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss
what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)

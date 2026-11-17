<?php

use App\Http\Controllers\OrderController;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Vifrost\Laravel\SchemaExporter;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Order;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Refund;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Customer;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\OrderItem;

require_once __DIR__ . '/../Support/DatasetControllers.php';

/**
 * Denies listing to everyone, standing in for an app policy.
 */
class DenyDatasetListing
{
    /**
     * @param mixed $user
     * @return bool
     */
    public function viewAny($user = null): bool
    {
        return false;
    }
}

/**
 * Requests a dataset of orders.
 *
 * @param array $query the dataset's query parameters
 * @param string $path the collection path
 * @return \Illuminate\Testing\TestResponse
 */
function requestDataset(array $query, string $path = 'api/order')
{
    return test()->getJson('/' . $path . '?' . http_build_query($query));
}

beforeEach(function () {
    config([
        'vifrost.models_path' => 'DatasetModels',
        'vifrost.dataset.max_limit' => 50,
        'vifrost.dataset.max_limit_per_model' => [],
        'vifrost.dataset.timeout_ms' => 5000,
        'vifrost.dataset.max_has_depth' => 3,
    ]);
    OrderController::reset();

    Route::get('api/order', [OrderController::class, 'index']);
    Route::get('api/order/{id}', [OrderController::class, 'show']);
    Route::get('api/customer/{id}/orders', [OrderController::class, 'index']);

    foreach (['ds_refunds', 'ds_order_items', 'ds_order_watchers', 'ds_orders', 'ds_customers'] as $table) {
        Schema::dropIfExists($table);
    }
    Schema::create('ds_customers', function (Blueprint $table) {
        $table->id();
        $table->string('name');
        $table->string('api_token');
        $table->boolean('active');
    });
    Schema::create('ds_orders', function (Blueprint $table) {
        $table->id();
        $table->foreignId('customer_id')->nullable()->constrained('ds_customers');
        $table->string('status');
        $table->decimal('amount', 8, 2);
        $table->date('placed_on');
    });
    Schema::create('ds_order_items', function (Blueprint $table) {
        $table->id();
        $table->foreignId('order_id')->constrained('ds_orders');
        $table->string('kind');
        $table->decimal('cost', 8, 2);
    });
    Schema::create('ds_order_watchers', function (Blueprint $table) {
        $table->foreignId('order_id')->constrained('ds_orders');
        $table->foreignId('customer_id')->constrained('ds_customers');
        $table->boolean('is_primary')->default(false);
    });
    Schema::create('ds_refunds', function (Blueprint $table) {
        $table->id();
        $table->foreignId('order_item_id')->constrained('ds_order_items');
        $table->string('code');
        $table->boolean('voided')->default(false);
    });

    $alice = Customer::create(['name' => 'Alice', 'api_token' => 'token-a', 'active' => true]);
    $bob = Customer::create(['name' => 'Bob', 'api_token' => 'token-b', 'active' => true]);
    $carol = Customer::create(['name' => 'Carol', 'api_token' => 'token-c', 'active' => false]);

    $orders = [
        [$alice, 'done', 100, '2026-01-10', [['cable', 20, []], ['mouse', 40, [['X1', false]]]]],
        [$alice, 'done', 50, '2026-01-20', [['cable', 20, []]]],
        [$bob, 'open', 30, '2026-02-01', []],
        [$bob, 'done', 70, '2026-02-05', [['mouse', 40, [['X3', false]]], ['monitor', 300, [['X2', true]]]]],
        [$carol, 'done', 999, '2026-02-07', [['monitor', 300, []]]],
        [null, 'open', 10, '2026-03-01', []],
    ];
    $watchers = [1 => [[$alice, true], [$bob, false]], 2 => [[$alice, false]], 4 => [[$carol, true], [$bob, true]]];
    foreach ($orders as [$customer, $status, $amount, $date, $items]) {
        $order = Order::create([
            'customer_id' => $customer?->id,
            'status' => $status,
            'amount' => $amount,
            'placed_on' => $date,
        ]);
        foreach ($watchers[$order->id] ?? [] as [$watcher, $isPrimary]) {
            DB::table('ds_order_watchers')->insert(['order_id' => $order->id, 'customer_id' => $watcher->id, 'is_primary' => $isPrimary]);
        }
        foreach ($items as [$kind, $cost, $refunds]) {
            $item = OrderItem::create(['order_id' => $order->id, 'kind' => $kind, 'cost' => $cost]);
            foreach ($refunds as [$code, $voided]) {
                Refund::create(['order_item_id' => $item->id, 'code' => $code, 'voided' => $voided]);
            }
        }
    }
});

it('groups and counts through a join scoped by the joined model query()', function () {
    $response = requestDataset([
        'join' => 'customer',
        'select' => 'customer.name',
        'aggregate' => ['total' => 'count', 'revenue' => 'sum:amount'],
        'group' => 'customer.name',
        'sort' => 'customer.name',
        'limit' => 10,
    ])->assertOk();

    expect($response->json())->toEqual([
        ['customer.name' => 'Alice', 'total' => 2, 'revenue' => 150.0],
        ['customer.name' => 'Bob', 'total' => 2, 'revenue' => 100.0],
    ])->and($response->headers->get('X-Total-Count'))->toBe('2');
});

it('keeps rows without a match on a left join', function () {
    $rows = requestDataset([
        'join' => 'customer:left',
        'select' => 'customer.name',
        'aggregate' => ['total' => 'count'],
        'group' => 'customer.name',
        'sort' => '-total',
        'limit' => 10,
    ])->assertOk()->json();

    expect(collect($rows)->firstWhere('customer.name', null)['total'])->toBe(2)
        ->and(array_sum(array_column($rows, 'total')))->toBe(6);
});

it('returns one row for aggregates alone', function () {
    $response = requestDataset([
        'aggregate' => ['total' => 'count', 'average' => 'avg:amount', 'first' => 'min:placed_on'],
        'limit' => 1,
    ])->assertOk();

    expect($response->json('0.total'))->toBe(6)
        ->and(round($response->json('0.average'), 2))->toBe(209.83)
        ->and($response->json('0.first'))->toStartWith('2026-01-10')
        ->and($response->headers->get('X-Total-Count'))->toBe('1');
});

it('selects plain columns with conditions and groups of them', function () {
    $rows = requestDataset([
        'select' => 'status,amount',
        'where' => [
            ['column' => 'status', 'op' => '=', 'value' => 'done'],
            ['or' => [
                ['column' => 'amount', 'op' => '>', 'value' => 80],
                ['column' => 'placed_on', 'op' => 'between', 'value' => ['2026-01-15', '2026-01-31']],
            ]],
            ['column' => 'customer_id', 'op' => 'notNull'],
        ],
        'sort' => '-amount',
        'limit' => 10,
    ])->assertOk()->json();

    expect(array_map('floatval', array_column($rows, 'amount')))->toBe([999.0, 100.0, 50.0]);
});

it('filters by whereHas with conditions and a count', function () {
    $rows = requestDataset([
        'select' => 'amount',
        'has' => ['items' => ['count' => '>=2', 'where' => [['column' => 'cost', 'op' => '>=', 'value' => 20]]]],
        'sort' => 'amount',
        'limit' => 10,
    ])->assertOk()->json();

    expect(array_map('floatval', array_column($rows, 'amount')))->toBe([70.0, 100.0]);
});

it('filters by nested whereHas, scoped by each level model query()', function (string $code, array $amounts) {
    $rows = requestDataset([
        'select' => 'amount',
        'has' => ['items' => ['has' => ['refunds' => ['where' => [['column' => 'code', 'op' => '=', 'value' => $code]]]]]],
        'sort' => 'amount',
        'limit' => 10,
    ])->assertOk()->json();

    expect(array_map('floatval', array_column($rows, 'amount')))->toBe($amounts);
})->with([
    'a live refund' => ['X1', [100.0]],
    'a voided refund' => ['X2', []],
]);

it('filters by whereDoesntHave', function () {
    $rows = requestDataset(['select' => 'amount', 'has' => ['items' => ['negate' => '1']], 'sort' => 'amount', 'limit' => 10])
        ->assertOk()->json();

    expect(array_map('floatval', array_column($rows, 'amount')))->toBe([10.0, 30.0]);
});

it('aggregates a joined to-many relation', function () {
    $rows = requestDataset([
        'join' => 'items',
        'select' => 'items.kind',
        'aggregate' => ['cost' => 'sum:items.cost'],
        'group' => 'items.kind',
        'sort' => 'items.kind',
        'limit' => 10,
    ])->assertOk()->json();

    expect($rows)->toEqual([
        ['items.kind' => 'cable', 'cost' => 40.0],
        ['items.kind' => 'monitor', 'cost' => 600.0],
        ['items.kind' => 'mouse', 'cost' => 80.0],
    ]);
});

it('groups by date periods, each the first date of its period', function (string $unit, array $expected) {
    $rows = requestDataset([
        'group' => ['period' => "placed_on:{$unit}"],
        'aggregate' => ['total' => 'count'],
        'sort' => 'period',
        'limit' => 10,
    ])->assertOk()->json();

    expect(array_combine(array_column($rows, 'period'), array_column($rows, 'total')))->toBe($expected);
})->with([
    'day' => ['day', ['2026-01-10' => 1, '2026-01-20' => 1, '2026-02-01' => 1, '2026-02-05' => 1, '2026-02-07' => 1, '2026-03-01' => 1]],
    'week' => ['week', ['2026-01-05' => 1, '2026-01-19' => 1, '2026-01-26' => 1, '2026-02-02' => 2, '2026-02-23' => 1]],
    'month' => ['month', ['2026-01-01' => 2, '2026-02-01' => 3, '2026-03-01' => 1]],
    'year' => ['year', ['2026-01-01' => 6]],
]);

it('groups by date periods next to columns', function () {
    $rows = requestDataset([
        'select' => 'status',
        'aggregate' => ['total' => 'count'],
        'group' => ['status', 'month' => 'placed_on:month'],
        'sort' => 'month,status',
        'limit' => 10,
    ])->assertOk()->json();

    expect($rows)->toBe([
        ['status' => 'done', 'month' => '2026-01-01', 'total' => 2],
        ['status' => 'done', 'month' => '2026-02-01', 'total' => 2],
        ['status' => 'open', 'month' => '2026-02-01', 'total' => 1],
        ['status' => 'open', 'month' => '2026-03-01', 'total' => 1],
    ]);
});

it('joins a BelongsToMany through its pivot, scoped by the related model query() and the pivot conditions', function (string $relation, array $expected) {
    $rows = requestDataset([
        'join' => $relation,
        'select' => "{$relation}.name",
        'aggregate' => ['total' => 'count'],
        'group' => "{$relation}.name",
        'sort' => "{$relation}.name",
        'limit' => 10,
    ])->assertOk()->json();

    expect(array_combine(array_column($rows, "{$relation}.name"), array_column($rows, 'total')))->toBe($expected);
})->with([
    'every watcher' => ['watchers', ['Alice' => 2, 'Bob' => 2]],
    'primary watchers only' => ['primaryWatchers', ['Alice' => 1, 'Bob' => 1]],
]);

it('joins a relation with the conditions it declares', function () {
    $rows = requestDataset([
        'join' => 'expensiveItems',
        'aggregate' => ['rows' => 'count', 'cost' => 'sum:expensiveItems.cost'],
        'limit' => 1,
    ])->assertOk()->json();

    expect($rows)->toEqual([['rows' => 2, 'cost' => 600.0]]);
});

it('runs a dataset of a nested relation collection', function () {
    expect(requestDataset(['aggregate' => ['total' => 'count'], 'limit' => 1], 'api/customer/1/orders')->json('0.total'))
        ->toBe(2);
});

it('requires a limit within the dataset max', function (array $limit) {
    requestDataset(['aggregate' => ['total' => 'count']] + $limit)->assertStatus(422);
})->with([
    'missing' => [[]],
    'over the max' => [['limit' => 51]],
    'not a number' => [['limit' => 'ten']],
]);

it('allows a model its own max limit', function () {
    config(['vifrost.dataset.max_limit_per_model' => [Order::class => 100]]);

    requestDataset(['aggregate' => ['total' => 'count'], 'limit' => 100])->assertOk();
});

it('rejects what the rules do not allow', function (array $query) {
    requestDataset($query + ['limit' => 10])->assertStatus(400);
})->with([
    'a column' => [['select' => 'secret']],
    'a join' => [['join' => 'refunds', 'select' => 'status']],
    'a joined column without its join' => [['select' => 'customer.name']],
    'a has' => [['select' => 'status', 'has' => ['refunds' => '']]],
    'a column of a has' => [['select' => 'status', 'has' => ['items' => ['where' => [['column' => 'secret', 'op' => '=', 'value' => 1]]]]]],
    'an operator' => [['select' => 'status', 'where' => [['column' => 'status', 'op' => 'like', 'value' => 'd%']]]],
    'a sort by something not selected' => [['select' => 'status', 'sort' => 'amount']],
    'an ungrouped column next to an aggregate' => [['select' => 'status', 'aggregate' => ['total' => 'count']]],
    'a key requested twice' => [['select' => 'status', 'aggregate' => ['status' => 'count'], 'group' => 'status']],
    'a count on a negated has' => [['select' => 'status', 'has' => ['items' => ['negate' => '1', 'count' => '2']]]],
    'a period unit' => [['group' => ['period' => 'placed_on:quarter']]],
    'a period of a column not allowed' => [['group' => ['period' => 'secret:month']]],
    'a grouped column not allowed' => [['aggregate' => ['total' => 'count'], 'group' => ['secret']]],
]);

it('rejects an aggregate function the rules do not allow', function () {
    OrderController::$aggregates = ['count'];

    requestDataset(['aggregate' => ['revenue' => 'sum:amount'], 'limit' => 1])->assertStatus(400);
});

it('rejects a whereHas nested deeper than allowed', function () {
    config(['vifrost.dataset.max_has_depth' => 1]);

    requestDataset(['select' => 'status', 'has' => ['items' => ['has' => ['refunds' => '']]], 'limit' => 10])->assertStatus(400);
});

it('reports a mistake in the rules as an error of the app', function (callable $breakRules) {
    $breakRules();

    expect(fn () => test()->withoutExceptionHandling()->getJson('/api/order?select=status&limit=1'))
        ->toThrow(LogicException::class);
})->with([
    'a hidden column' => [fn () => OrderController::$columns[] = 'customer.api_token'],
    'a nested has without its parent' => [fn () => OrderController::$has = ['items.refunds']],
    'a join that is not BelongsTo, HasOne, HasMany or BelongsToMany' => [fn () => OrderController::$joins[] = 'refunds'],
    'a rule that does not exist' => [fn () => OrderController::$extra = ['filters' => ['status']]],
]);

it('says datasets are not enabled when no column or aggregate is allowed', function () {
    OrderController::$columns = [];
    OrderController::$aggregates = [];

    expect(requestDataset(['select' => 'status', 'limit' => 1])->assertStatus(400)->json('message'))
        ->toContain('not enabled');
});

it('authorizes the joined model through its query()', function () {
    Gate::policy(Customer::class, DenyDatasetListing::class);

    requestDataset(['join' => 'customer', 'select' => 'customer.name', 'group' => 'customer.name', 'limit' => 10])
        ->assertStatus(403);
});

it('authorizes every whereHas level through its model query()', function () {
    Gate::policy(Refund::class, DenyDatasetListing::class);

    requestDataset(['select' => 'status', 'has' => ['items' => ['has' => ['refunds' => '']]], 'limit' => 10])
        ->assertStatus(403);
});

it('leaves requests without a dataset to Spatie', function () {
    $rows = test()->getJson('/api/order?include=customer&sort=id&limit=2')->assertOk()->json();

    expect($rows)->toHaveCount(2)
        ->and($rows[0])->toHaveKeys(['id', 'status', 'customer'])
        ->and($rows[0]['customer'])->not->toHaveKey('api_token');
});

it('ignores dataset parameters on a single record', function () {
    expect(test()->getJson('/api/order/1?select=status')->assertOk()->json('id'))->toBe(1);
});

it('cancels a dataset that runs longer than its timeout and restores the session', function () {
    $driver = DB::connection()->getDriverName();
    if ($driver === 'sqlite') {
        $this->markTestSkipped('SQLite has no statement timeout.');
    }

    $readTimeout = fn () => match ($driver) {
        'pgsql' => DB::selectOne('SHOW statement_timeout')->statement_timeout,
        'mariadb' => DB::selectOne('SELECT @@SESSION.max_statement_time AS t')->t,
        default => DB::selectOne('SELECT @@SESSION.max_execution_time AS t')->t,
    };
    $before = $readTimeout();
    config(['vifrost.dataset.timeout_ms' => 100]);
    OrderController::$slow = true;

    requestDataset(['aggregate' => ['total' => 'count'], 'limit' => 1])->assertStatus(504);

    expect($readTimeout())->toBe($before);
});

it('does not bound a model whose timeout is disabled', function () {
    config(['vifrost.dataset.timeout_ms_per_model' => [Order::class => null]]);

    requestDataset(['aggregate' => ['total' => 'count'], 'limit' => 1])->assertOk();
});

it('exports what the datasets of a model allow, read from its controller rule methods', function () {
    $schema = SchemaExporter::build([Order::class, Customer::class]);
    $dataset = $schema['models'][Order::class]['dataset'];

    expect($dataset['maxLimit'])->toBe(50)
        ->and(array_keys($dataset['columns']))->toBe(['status', 'amount', 'placed_on', 'customer_id'])
        ->and($dataset['columns']['customer_id']['isNullable'])->toBeTrue()
        ->and($dataset['joins']['customer'])->toMatchArray(['model' => Customer::class, 'type' => 'BelongsTo'])
        ->and(array_keys($dataset['joins']['customer']['columns']))->toBe(['name'])
        ->and(array_keys($dataset['joins']['items']['columns']))->toBe(['kind', 'cost'])
        ->and(array_keys($dataset['has']['items']['columns']))->toBe(['kind', 'cost'])
        ->and(array_keys($dataset['has']['items']['has']['refunds']['columns']))->toBe(['code'])
        ->and($dataset['has']['items']['has']['refunds']['has'])->toBe([])
        ->and($dataset['aggregates'])->toBe(['count', 'sum', 'avg', 'min', 'max'])
        ->and($schema['models'][Customer::class])->not->toHaveKey('dataset');
});

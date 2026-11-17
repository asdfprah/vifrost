<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Vifrost\Laravel\Pagination;
use Vifrost\Laravel\QueryBuilder;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Order;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Refund;
use Vifrost\Laravel\Tests\Fixtures\DatasetModels\Customer;
use Vifrost\Laravel\Vifrost;

/**
 * Same query() and index() as Controller.stub generates, with dataset rules each test can change.
 */
class OrderController
{
    /**
     * @var array
     */
    public static array $columns = [];

    /**
     * @var array
     */
    public static array $joins = [];

    /**
     * @var array
     */
    public static array $has = [];

    /**
     * @var array
     */
    public static array $aggregates = [];

    /**
     * Rules added to allowedDataset() as given, to check how unknown ones are reported.
     *
     * @var array
     */
    public static array $extra = [];

    /**
     * Makes every query of the root table sleep, to exceed a statement timeout.
     *
     * @var bool
     */
    public static bool $slow = false;

    /**
     * Restores the rules every dataset test starts from.
     *
     * @return void
     */
    public static function reset(): void
    {
        self::$columns = [
            'status', 'amount', 'placed_on', 'customer_id',
            'customer.name', 'items.kind', 'items.cost',
            'watchers.name', 'primaryWatchers.name', 'expensiveItems.cost',
            'items.refunds.code',
        ];
        self::$joins = ['customer', 'items', 'watchers', 'primaryWatchers', 'expensiveItems'];
        self::$has = ['items', 'items.refunds'];
        self::$aggregates = ['count', 'sum', 'avg', 'min', 'max'];
        self::$slow = false;
        self::$extra = [];
    }

    /**
     * @param \Illuminate\Http\Request $request
     * @return \Vifrost\Laravel\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        if (Gate::getPolicyFor(Order::class)) {
            Gate::authorize('viewAny', Order::class);
        }

        $query = (new Vifrost)->getQuery($request);

        if (self::$slow) {
            $query->whereRaw(self::sleepExpression());
        }

        return QueryBuilder::for($query, $request)
            ->allowedFilters([])
            ->allowedIncludes(['customer', 'items'])
            ->allowedSorts(['id'])
            ->allowedDataset($this->allowedDataset());
    }

    /**
     * @return array
     */
    private function allowedDataset(): array
    {
        return [
            'columns' => self::$columns,
            'joins' => self::$joins,
            'has' => self::$has,
            'aggregates' => self::$aggregates,
        ] + self::$extra;
    }

    /**
     * @return \Illuminate\Http\JsonResponse
     */
    public function index(): JsonResponse
    {
        $queryBuilder = $this->query(request());

        $total = $queryBuilder->toBase()->getCountForPagination();

        Pagination::apply($queryBuilder, Order::class);

        return response()->json($queryBuilder->get())
            ->header('X-Total-Count', $total);
    }

    /**
     * @return mixed
     */
    public function show()
    {
        return $this->query(request())->firstOrFail();
    }

    /**
     * A condition that is true after sleeping half a second, in the dialect of the connection.
     *
     * @return string
     */
    private static function sleepExpression(): string
    {
        return match (DB::connection()->getDriverName()) {
            'pgsql' => "pg_sleep(0.5)::text = ''",
            default => 'SLEEP(0.5) = 0',
        };
    }
}

/**
 * Lists active customers only, as an app would scope them.
 */
class CustomerController
{
    /**
     * @param \Illuminate\Http\Request $request
     * @return \Vifrost\Laravel\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        if (Gate::getPolicyFor(Customer::class)) {
            Gate::authorize('viewAny', Customer::class);
        }

        return QueryBuilder::for((new Vifrost)->getQuery($request)->where('active', true), $request);
    }
}

/**
 * Lists every order item.
 */
class OrderItemController
{
    /**
     * @param \Illuminate\Http\Request $request
     * @return \Vifrost\Laravel\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        return QueryBuilder::for((new Vifrost)->getQuery($request), $request);
    }
}

/**
 * Lists refunds that were not voided.
 */
class RefundController
{
    /**
     * @param \Illuminate\Http\Request $request
     * @return \Vifrost\Laravel\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        if (Gate::getPolicyFor(Refund::class)) {
            Gate::authorize('viewAny', Refund::class);
        }

        return QueryBuilder::for((new Vifrost)->getQuery($request)->where('voided', false), $request);
    }
}

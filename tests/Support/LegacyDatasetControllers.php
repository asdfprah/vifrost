<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Vifrost\Laravel\Pagination;
use Vifrost\Laravel\QueryBuilder;
use Vifrost\Laravel\Tests\Fixtures\LegacyDatasetModels\Coupon;
use Vifrost\Laravel\Vifrost;

/**
 * A controller as Controller.stub generated it in 0.9.0, with one method per dataset rule.
 */
class CouponController
{
    /**
     * @return array
     */
    private function allowedColumns(): array
    {
        return ['code', 'percent'];
    }

    /**
     * @return array
     */
    private function allowedJoins(): array
    {
        return [];
    }

    /**
     * @return array
     */
    private function allowedHas(): array
    {
        return [];
    }

    /**
     * @return array
     */
    private function allowedAggregates(): array
    {
        return ['count'];
    }

    /**
     * @param \Illuminate\Http\Request $request
     * @return \Vifrost\Laravel\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        return QueryBuilder::for((new Vifrost)->getQuery($request), $request)
            ->allowedSorts(['id'])
            ->allowedColumns($this->allowedColumns())
            ->allowedJoins($this->allowedJoins())
            ->allowedHas($this->allowedHas())
            ->allowedAggregates($this->allowedAggregates());
    }

    /**
     * @return \Illuminate\Http\JsonResponse
     */
    public function index(): JsonResponse
    {
        $queryBuilder = $this->query(request());

        $total = $queryBuilder->toBase()->getCountForPagination();

        Pagination::apply($queryBuilder, Coupon::class);

        return response()->json($queryBuilder->get())
            ->header('X-Total-Count', $total);
    }
}

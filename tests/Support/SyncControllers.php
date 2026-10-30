<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;
use Vifrost\Laravel\Vifrost;

/**
 * Same query() as Controller.stub generates, customized the way a developer would:
 * archived tickets are never listed.
 */
class TicketController
{
    /**
     * @param \Illuminate\Http\Request $request
     * @return \Spatie\QueryBuilder\QueryBuilder
     */
    public function query(Request $request): QueryBuilder
    {
        return QueryBuilder::for((new Vifrost)->getQuery($request)->where('archived', false), $request)
            ->allowedFilters([AllowedFilter::exact('status')])
            ->allowedSorts(['id', 'title']);
    }
}

/**
 * A controller generated before query() existed.
 */
class BoardController
{
}
